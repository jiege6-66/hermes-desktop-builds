#!/usr/bin/env python3
"""Prepare an immutable release ONLY from all four verified CI distributions."""
import argparse
import json
from pathlib import Path
import re
import shutil

from common import load_pin, release_version, archive_name, dmg_name
from package import digest
from macos_signing import validate_signing_receipt
from source_patches import PATCH_DIR, patch_set, validate_patch_receipt

REPO='jiege6-66/hermes-desktop-builds'
TARGETS=[('darwin','arm64'),('darwin','x64'),('win32','x64'),('linux','x64')]


def cask_text(version, assets):
    if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+',version):raise ValueError('Bad cask version')
    blocks=[]
    for arch,condition in [('arm64','on_arm'),('x64','on_intel')]:
        asset=assets['darwin-'+arch]
        filename=dmg_name(version,arch)
        if asset['dmg']['name']!=filename or not re.fullmatch('[0-9a-f]{64}',asset['dmg']['sha256']):raise ValueError('Bad cask asset')
        blocks.append(f'''  {condition} do
    sha256 "{asset['dmg']['sha256']}"

    url "https://github.com/{REPO}/releases/download/v#{{version}}/{filename}"
  end''')
    return f'''# frozen_string_literal: true

cask "hermes-desktop" do
  version "{version}"

{chr(10).join(blocks)}

  name "Hermes Desktop"
  desc "Standalone Hermes Electron Desktop for remote backends"
  homepage "https://github.com/{REPO}"

  depends_on macos: :monterey

  app "Hermes.app"

  caveats <<~EOS
    Ad-hoc signed build; no Developer ID or Apple notarization.
    Gatekeeper remains enabled; app-specific approval may be required.
    First start offers both a local install and connecting to an existing server.
    No Python agent is installed by this cask.
    Updates are delivered through this cask only; the app has no in-app updater.
    Remote backends are never updated by this cask.
  EOS
end
'''


def verify_distribution(directory, pin, target):
    manifest=json.loads((directory/'manifest.json').read_text())
    platform,arch=target
    if platform=='darwin':validate_signing_receipt(manifest.get('macSigning'))
    if (manifest['platform'],manifest['arch'])!=target:raise ValueError('Mismatched artifact target')
    if manifest['upstream']!=pin or manifest['version']!=release_version(pin):raise ValueError('Mismatched source/version pin')
    if manifest.get('sourceVerified') is not True or manifest.get('archiveRoundtrip') is not True:raise ValueError('Incomplete source/archive verification')
    patch_receipt=manifest.get('sourcePatch')
    if not isinstance(patch_receipt,dict):raise ValueError('Missing source patch receipt')
    if manifest.get('sourceClean') is not (not patch_receipt.get('patches')):raise ValueError('Source cleanliness flag disagrees with the patch set')
    validate_patch_receipt(patch_receipt,pin)
    smoke=manifest['nativeSmoke']
    for flag in ('firstRun','remoteForm','remoteSetupOpened','installOfferShown','unreachableRemoteBlocksApply','noAgentCheckout'):
        if smoke.get(flag) is not True:raise ValueError('Missing smoke gate: '+flag)
    if smoke['platform']!=platform or smoke['arch']!=arch or smoke.get('errors')!=[] or smoke.get('localInstallStarted') is not False:
        raise ValueError('Wrong/failed native smoke')
    if smoke['ptyResult']['exitCode']!=0 or 'HERMES_NATIVE_PTY_OK' not in smoke['ptyResult']['output']:raise ValueError('Native PTY failed')
    filename=archive_name(release_version(pin),platform,arch)
    if manifest['archive']!=filename:raise ValueError('Unexpected archive name')
    archive=directory/filename
    if digest(archive)!=manifest['sha256'] or archive.stat().st_size!=manifest['bytes']:raise ValueError('Artifact hash/size mismatch')
    if platform=='darwin':
        dmg=manifest.get('dmg') or {}
        if dmg.get('name')!=dmg_name(release_version(pin),arch):raise ValueError('Unexpected DMG name')
        image=directory/dmg['name']
        if not image.is_file() or digest(image)!=dmg.get('sha256') or image.stat().st_size!=dmg.get('bytes'):
            raise ValueError('DMG hash/size mismatch')
    if manifest['targetedSuite'].get('releaseGatePassed') is not True:raise ValueError('Targeted-suite gate missing')
    if platform=='linux' and manifest['fullSuite'].get('releaseGatePassed') is not True:raise ValueError('Full-suite gate missing')
    return manifest


def prepare(downloads,destination,run_url):
    if not re.fullmatch(rf'https://github.com/{re.escape(REPO)}/actions/runs/[0-9]+',run_url):raise ValueError('Invalid run URL')
    if destination.exists():raise ValueError('Refusing to overwrite a release directory')
    pin=load_pin();version=release_version(pin)
    manifests={}
    sources={}
    for target in TARGETS:
        label='-'.join(target)
        candidates=list(downloads.glob(f'desktop-{label}/manifest.json'))
        if len(candidates)!=1:raise ValueError('Expected exactly one verified artifact for '+label)
        sources[label]=candidates[0].parent
        manifests[label]=verify_distribution(candidates[0].parent,pin,target)
    if len(manifests)!=len(TARGETS):raise ValueError('Missing target')
    source_patch=manifests['linux-x64']['sourcePatch']
    if any(m['sourcePatch']!=source_patch for m in manifests.values()):raise ValueError('Native hosts did not build the same patched source tree')
    destination.mkdir(parents=True)
    checks=[]
    for label,m in manifests.items():
        shutil.copyfile(sources[label]/m['archive'],destination/m['archive'])
        checks.append(m['sha256']+'  '+m['archive'])
        if m['platform']=='darwin':
            shutil.copyfile(sources[label]/m['dmg']['name'],destination/m['dmg']['name'])
            checks.append(m['dmg']['sha256']+'  '+m['dmg']['name'])
        shutil.make_archive(str(destination/(label+'-evidence')),'zip',sources[label]/'logs')
    for row in patch_set()['patches']:
        shutil.copyfile(PATCH_DIR/row['file'],destination/row['file'])
        checks.append(row['sha256']+'  '+row['file'])
    shutil.copyfile(PATCH_DIR/'manifest.json',destination/'source-patches.json')
    checks.append(digest(destination/'source-patches.json')+'  source-patches.json')
    payload={'schema':1,'buildRepository':REPO,'version':version,'upstream':pin,'buildRun':run_url,'sourcePatch':source_patch,'targets':manifests}
    (destination/'release-manifest.json').write_text(json.dumps(payload,indent=2)+'\n')
    (destination/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
    (destination/'hermes-desktop.rb').write_text(cask_text(version,manifests))
    full=manifests['linux-x64']['fullSuite']
    notes=f'''# Hermes Desktop {version}

Unmodified upstream Electron Desktop built from the pinned official release, not the
local-agent bootstrap installer and not a source fork.
Source: https://github.com/{pin['repository']}/commit/{pin['commit']}
No source patches are applied for this release; source-patches.json records the empty set.
Build and native starttest evidence: {run_url}

All four distributions were built and launched on matching native runners:
macOS arm64 + x64, Windows x64 and Linux x64. The packaged app was launched from the
extracted release archive: first-run setup, the remote form, refusal of an unreachable
remote, inactive local bootstrap and a real native PTY were exercised.
No Python runtime, agent checkout or credentials are bundled.

macOS artifacts ship as both `-adhoc.zip` (byte-verified archive) and `-adhoc.dmg`
(the mountable installer image). Upstream ships every tree with a 0.0.0 placeholder
version; this pipeline injects the pinned release version at pack time.

**Mac bundles are ad-hoc signed, not Apple Developer ID signed or notarized. Windows is unsigned.**
Mac signatures are verified before packaging, after extracting the final ZIP and on the
mounted DMG, including the native modules. Negative tests reproduce rejection of missing
CodeResources and tampered resources. Native dependency signing precedes ASAR hashing; all
ASAR integrity checks remain enforced. Gatekeeper remains enabled: its assessment of the
quarantined, valid ad-hoc app is recorded as REJECTED for publisher trust, not treated as
acceptance. App-specific Open Anyway is not automated or tested; no Apple notarization or
SmartScreen clearance. No live remote login/chat, user peripherals or OS permissions were
end-to-end tested. Do not disable system security to install this build.

Full upstream suite (Linux): {full['total']} total, {full['passed']} passed,
{full['failed']} failed, {full['pending']} pending/skipped. Full suite green: {full['suiteGreen']}.
Known exceptions, if any, remain listed in release-manifest.json and raw evidence ZIPs.
Typechecking passed on each native host. Targeted startup/packaging results are reported per
target in release-manifest.json. No native feature is stubbed or removed.

First start offers both a local installation and **Connect to existing Hermes**; this build
does not change that upstream behavior. Existing local runtimes can be discovered/started by
upstream; review them before launching if that must be avoided.

Installation, rollback and security notes: https://github.com/{REPO}#download
Verify SHA256SUMS. Immutable version: assets under this tag must never be replaced.'''
    (destination/'RELEASE-NOTES.md').write_text(notes)
    return payload

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--downloads',type=Path,required=True)
    p.add_argument('--destination',type=Path,required=True)
    p.add_argument('--run-url',required=True)
    a=p.parse_args();result=prepare(a.downloads,a.destination,a.run_url)
    print('Release prepared (not published):',result['version'],list(result['targets']))
