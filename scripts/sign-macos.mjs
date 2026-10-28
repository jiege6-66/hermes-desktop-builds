import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const machoMagics = new Set(['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface',
                             'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

export function signingOptions(source, app) {
  const desktop = path.join(source, 'apps/desktop');
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  // Upstream removed the `build` block from package.json; the electron version
  // lives in devDependencies and the entitlement files in electron/.
  const build = pkg.build || {};
  const mac = build.mac || {};
  const electronVersion = build.electronVersion || (pkg.devDependencies || {}).electron;
  assert(typeof electronVersion === 'string' && /^\d+\.\d+\.\d+/.test(electronVersion),
         'Cannot resolve the Electron version for signing');
  const entitlements = mac.entitlements || path.join(desktop, 'electron/entitlements.mac.plist');
  const entitlementsInherit = mac.entitlementsInherit
    || path.join(desktop, 'electron/entitlements.mac.inherit.plist');
  assert(fs.existsSync(entitlements) && fs.existsSync(entitlementsInherit),
         'Missing upstream Mac entitlements');
  const unpacked = path.join(app, 'Contents/Resources/app.asar.unpacked') + path.sep;
  const realApp = fs.realpathSync(app);
  return {
    app, platform: 'darwin', type: 'distribution', identity: '-', identityValidation: false,
    version: electronVersion, strictVerify: true,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile(file) {
      return {
        entitlements: path.resolve(desktop, file === app ? entitlements : entitlementsInherit),
        hardenedRuntime: true, timestamp: 'none',
      };
    },
    // osx-sign 1.3.3 drops array-valued ignore during normalization; use a function.
    ignore(file) {
      // Already signed before ASAR hashing; signing again would stale its integrity header.
      if (file.startsWith(unpacked)) return true;
      // Do not sign aliases twice, or create xattr signatures on PNG/PAK/ASAR data.
      if (fs.realpathSync(file) !== path.join(realApp, path.relative(app, file))) return true;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) return !['.app', '.framework'].includes(path.extname(file));
      if (!stat.isFile()) return true;
      const fd = fs.openSync(file, 'r');
      try {
        const magic = Buffer.alloc(4);
        return fs.readSync(fd, magic, 0, 4, 0) !== 4 || !machoMagics.has(magic.toString('hex'));
      } finally { fs.closeSync(fd); }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.platform, 'darwin', 'Signing requires a native Mac');
  const [source, app] = process.argv.slice(2).map(p => path.resolve(p));
  assert(source && app && app.endsWith('.app'));
  const require = createRequire(path.join(source, 'apps/desktop/package.json'));
  const {sign, signAsync} = require('@electron/osx-sign');
  // @electron/osx-sign 2.x renamed signAsync to sign; accept either pinned shape.
  const signApp = sign || signAsync;
  assert.equal(typeof signApp, 'function', 'No usable @electron/osx-sign entry point');
  await signApp(signingOptions(source, app));
  console.log('Final Mac bundle ad-hoc signed inside-out with upstream entitlements.');
  console.log('No Developer ID, notarization, keychain discovery or security-policy changes.');
}
