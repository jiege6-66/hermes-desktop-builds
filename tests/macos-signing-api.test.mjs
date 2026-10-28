// Dependency-contract unit test ONLY: codesign is a PATH shim, never the real tool.
// Real codesign/native/UI/Gatekeeper tests run separately in scripts/build.py on Macs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {signingOptions} from '../scripts/sign-macos.mjs';

const source = process.env.DESKTOP_SIGNING_TEST_SOURCE;
assert(source, 'Point DESKTOP_SIGNING_TEST_SOURCE at the pinned npm-ci source tree');
const require = createRequire(path.join(source, 'apps/desktop/package.json'));
const {sign, signAsync} = require('@electron/osx-sign');
// @electron/osx-sign 2.x renamed signAsync to sign; accept either pinned shape.
const signApp = sign || signAsync;
assert.equal(typeof signApp, 'function', 'No usable @electron/osx-sign entry point');

// @electron/osx-sign ships ESM now, so its exports cannot be monkeypatched.
// Intercept the tool itself instead: a POSIX `codesign` shim records argv.
const posix = process.platform !== 'win32';

test('actual pinned signing API honors the exclusion callback before invoking codesign',
  {skip: posix ? false : 'PATH shim is POSIX-only; Mac lanes verify real signing'},
  async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-sign-api-test-'));
    const desktop = path.join(base, 'apps/desktop');
    const app = path.join(base, 'Hermes.app');
    const resources = path.join(app, 'Contents/Resources');
    const unpacked = path.join(resources, 'app.asar.unpacked');
    fs.mkdirSync(path.join(desktop, 'electron'), {recursive: true});
    fs.mkdirSync(unpacked, {recursive: true});
    // Upstream shape: no `build` block, electron in devDependencies, plists in electron/.
    fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({
      devDependencies: {electron: '44.9.3'},
    }));
    for (const plist of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
      fs.writeFileSync(path.join(desktop, 'electron', plist), '<plist><dict/></plist>');
    }
    const native = path.join(app, 'Contents/native');
    fs.writeFileSync(native, Buffer.from('cffaedfe00000000', 'hex'));
    const excluded = [path.join(resources, 'app.asar'), path.join(resources, 'icon.png'), path.join(unpacked, 'pty.node')];
    for (const file of excluded) fs.writeFileSync(file, Buffer.from('cffaedfe00000000', 'hex'));
    // app.asar/icon.png are arbitrary binary DATA rather than Mach-O in real builds.
    for (const file of excluded.slice(0, 2)) fs.writeFileSync(file, Buffer.from([0, 255, 128, 0]));

    const bin = path.join(base, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(base, 'codesign.log');
    const shim = path.join(bin, 'codesign');
    fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s|' "$@" >> ${JSON.stringify(log)}\nprintf '\\n' >> ${JSON.stringify(log)}\nexit 0\n`);
    fs.chmodSync(shim, 0o755);
    const env = process.env.PATH;
    process.env.PATH = bin + path.delimiter + env;
    try {
      await signApp(signingOptions(base, app));
    } finally {
      process.env.PATH = env;
    }
    const calls = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.split('|').filter(Boolean))
      : [];
    const signed = calls.filter(args => args.includes('--sign')).map(args => args.at(-1));
    assert.deepEqual(signed.sort(), [native, app].sort(),
      'Only unhashed Mach-O and the final bundle may be signed');
    for (const file of excluded) assert(!signed.includes(file), 'Must not sign ' + file);
    fs.rmSync(base, {recursive: true, force: true});
  });
