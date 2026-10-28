import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {signingOptions} from '../scripts/sign-macos.mjs';

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-sign-options-'));
  const desktop = path.join(base, 'apps/desktop');
  // Current upstream shape: no `build` block, electron in devDependencies and the
  // entitlement plists under apps/desktop/electron/.
  fs.mkdirSync(path.join(desktop, 'electron'), {recursive: true});
  fs.writeFileSync(path.join(desktop, 'package.json'),
    JSON.stringify({devDependencies: {electron: '44.9.3'}}));
  for (const name of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
    fs.writeFileSync(path.join(desktop, 'electron', name), '<plist><dict/></plist>');
  }
  const app = path.join(base, 'Hermes.app');
  fs.mkdirSync(path.join(app, 'Contents/Resources/app.asar.unpacked'), {recursive: true});
  return {base, app, options: signingOptions(base, app)};
}

test('ad-hoc identity is explicit; retain upstream entitlements and hardened runtime', () => {
  const {base, app, options} = fixture();
  try {
    assert.equal(options.identity, '-');
    assert.equal(options.identityValidation, false);
    assert.equal(options.preAutoEntitlements, false);
    assert.equal(options.preEmbedProvisioningProfile, false);
    assert.equal(options.strictVerify, true);
    assert.equal(options.version, '44.9.3');
    assert.equal(typeof options.ignore, 'function', 'Pinned osx-sign drops an ignore array');
    assert.equal(options.optionsForFile(app).hardenedRuntime, true);
    assert.equal(options.optionsForFile(app).timestamp, 'none');
    assert.match(options.optionsForFile(app).entitlements, /entitlements\.mac\.plist$/);
    assert.match(options.optionsForFile(path.join(app, 'Contents/Frameworks/Helper.app')).entitlements,
      /entitlements\.mac\.inherit\.plist$/);
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});

test('missing entitlements or electron version fails closed instead of signing blindly', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-sign-missing-'));
  const desktop = path.join(base, 'apps/desktop');
  fs.mkdirSync(desktop, {recursive: true});
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({devDependencies: {electron: '44.9.3'}}));
  const app = path.join(base, 'Hermes.app');
  fs.mkdirSync(app, {recursive: true});
  try {
    assert.throws(() => signingOptions(base, app), /entitlements/);
    fs.mkdirSync(path.join(desktop, 'electron'), {recursive: true});
    for (const name of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
      fs.writeFileSync(path.join(desktop, 'electron', name), '<plist><dict/></plist>');
    }
    fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({}));
    assert.throws(() => signingOptions(base, app), /Electron version/);
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});

test('sign only Mach-O code/bundles, never ASAR data or already-hashed unpacked modules', () => {
  const {base, app, options} = fixture();
  try {
    const ignore = options.ignore;
    const native = path.join(app, 'Contents/native');
    // This tiny magic header is a unit fixture, never part of a real application.
    fs.writeFileSync(native, Buffer.from('cffaedfe00000000', 'hex'));
    assert.equal(ignore(native), false);
    assert.equal(ignore(app), false);
    for (const name of ['app.asar', 'picture.png', 'snapshot.pak']) {
      const file = path.join(app, 'Contents/Resources', name);
      fs.writeFileSync(file, Buffer.from([0, 255, 128, 1, 2]));
      assert.equal(ignore(file), true, name);
    }
    const unpacked = path.join(app, 'Contents/Resources/app.asar.unpacked/pty.node');
    fs.copyFileSync(native, unpacked);
    assert.equal(ignore(unpacked), true, 'must not invalidate ASAR integrity after packaging');
    if (process.platform !== 'win32') {
      const alias = native + '-alias';
      fs.symlinkSync('native', alias);
      assert.equal(ignore(alias), true, 'never sign symlink aliases twice');
    }
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});
