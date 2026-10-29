import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';

const [source,binary,home,logs]=process.argv.slice(2);
assert(source&&binary&&home&&logs,'Usage: smoke.mjs source binary isolatedHome logs');
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(source,'apps/desktop/package.json'));
const {_electron}=require('playwright');
assert.equal(fs.existsSync(path.join(home,'.hermes')),false,'Smoke HOME must be fresh');
const env={...process.env};
env.PATH=process.platform==='win32'?path.join(env.SystemRoot||env.SYSTEMROOT||'C:\\Windows','System32'):'/usr/bin:/bin:/usr/sbin:/sbin';
const args=['--user-data-dir='+path.join(home,'u'),'--enable-logging=stderr'];
// Linux CI only: no host kernel/security changes; never Mac/Windows install advice.
if(process.platform==='linux'){delete env.DISPLAY;delete env.XAUTHORITY;args.push('--disable-gpu','--no-sandbox','--ozone-platform=headless');}
const errors=[];
let app;
try {
  app=await _electron.launch({executablePath:binary,args,env,timeout:90000});
  const page=await app.firstWindow({timeout:90000});
  page.on('pageerror',err=>errors.push(String(err)));
  await page.getByText('Install Hermes locally',{exact:true}).waitFor({timeout:90000});
  fs.writeFileSync(path.join(logs,'install-offer.txt'),await page.locator('body').innerText());
  // Stock upstream first run offers both paths; this build ships it unpatched,
  // so the remote form is reached by choosing it, once.
  await page.getByRole('button',{name:/Connect to existing Hermes/}).first().click();
  await page.getByRole('heading',{name:'Connect to existing Hermes',exact:true}).waitFor({timeout:90000});
  await page.getByPlaceholder('https://gateway.example.com/hermes').waitFor();
  fs.writeFileSync(path.join(logs,'first-run.txt'),await page.locator('body').innerText());
  const paths=await app.evaluate(({app})=>({packaged:app.isPackaged,path:app.getAppPath(),resources:process.resourcesPath,home:app.getPath('home'),userData:app.getPath('userData'),hermesHome:process.env.HERMES_HOME,platform:process.platform,arch:process.arch,versions:process.versions}));
  assert.equal(paths.packaged,true);
  assert.equal(paths.platform,process.platform);
  assert.equal(paths.arch,process.arch);
  assert.equal(paths.hermesHome,path.join(home,'.hermes'));
  const installStamp=JSON.parse(fs.readFileSync(path.join(paths.resources,'install-stamp.json'),'utf8'));
  const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.json'),'utf8'));
  assert.match(pin.version,/^\d+(?:\.\d+)+$/);
  const runtimeDesktopVersionInfo=await page.evaluate(()=>window.hermesDesktop.getVersion());
  assert.equal(typeof runtimeDesktopVersionInfo,'object');
  assert.equal(typeof runtimeDesktopVersionInfo.appVersion,'string');
  // Upstream trees carry a 0.0.0 placeholder; this pipeline injects the pinned
  // release version at pack time, so the running app must report it.
  const runtimeDesktopVersion=runtimeDesktopVersionInfo.appVersion;
  assert.notEqual(installStamp.distribution,'frankhommers-homebrew');
  assert.equal(installStamp.distributionVersion,undefined);
  assert.equal(runtimeDesktopVersion,pin.version);

  fs.writeFileSync(path.join(logs,'remote-form.txt'),await page.locator('body').innerText());
  const bootstrap=await page.evaluate(()=>window.hermesDesktop.getBootstrapState());
  assert.equal(bootstrap.active,false);
  assert.equal(bootstrap.manifest,null);
  assert.deepEqual(bootstrap.stages,{});
  // Stock upstream leaves setupChoice null until a bootstrap is ready; it must
  // never claim a local install was started by merely opening the app.
  if(bootstrap.setupChoice)assert.equal(bootstrap.setupChoice.local,'none');
  const guard=createServer();
  await new Promise(resolve=>guard.listen(0,'127.0.0.1',resolve));
  const port=guard.address().port;
  await new Promise(resolve=>guard.close(resolve));
  await page.getByPlaceholder('https://gateway.example.com/hermes').fill(`http://127.0.0.1:${port}`);
  const test=page.getByRole('button',{name:'Test connection',exact:true});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Test connection'&&!b.disabled));
  await test.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Test connection'&&!b.disabled));
  const remoteProbe=await page.evaluate(url=>window.hermesDesktop.probeConnectionConfig(url),`http://127.0.0.1:${port}`);
  assert.equal(remoteProbe.reachable,false);
  assert(remoteProbe.error,'Actual native IPC/network probe must return an error');
  assert.equal(await page.getByRole('button',{name:'Apply and reconnect',exact:true}).isDisabled(),true);
  fs.writeFileSync(path.join(logs,'unreachable-remote.txt'),await page.locator('body').innerText());
  const ptyResult=await app.evaluate(async({app})=>{
    const {createRequire}=process.getBuiltinModule('module');
    const req=createRequire(app.getAppPath()+'/dist/electron-main.mjs');
    const pty=req('node-pty');
    return await new Promise((resolve,reject)=>{
      let output='';
      const win=process.platform==='win32';
      const t=pty.spawn(win?process.env.ComSpec||process.env.COMSPEC||'C:\\Windows\\System32\\cmd.exe':'/bin/sh',win?['/d','/c','echo HERMES_NATIVE_PTY_OK']:['-c','printf HERMES_NATIVE_PTY_OK'],{name:'xterm',cols:80,rows:24,cwd:process.env.HOME,env:{...process.env}});
      const timeout=setTimeout(()=>{t.kill();reject(new Error('PTY timeout'));},15000);
      t.onData(s=>output+=s);
      t.onExit(({exitCode})=>{clearTimeout(timeout);resolve({exitCode,output});});
    });
  });
  assert.equal(ptyResult.exitCode,0);
  assert(ptyResult.output.includes('HERMES_NATIVE_PTY_OK'));
  const after=await page.evaluate(()=>window.hermesDesktop.getBootstrapState());
  assert.equal(after.active,false);assert.deepEqual(after.stages,{});
  assert(!fs.existsSync(path.join(home,'.hermes/hermes-agent')),'No local agent checkout');
  assert.equal(errors.length,0,JSON.stringify(errors));
  const result={platform:process.platform,arch:process.arch,paths,installStamp,runtimeDesktopVersionInfo,runtimeDesktopVersion,pinVersion:pin.version,firstRun:true,remoteForm:true,remoteSetupOpened:true,installOfferShown:true,unreachableRemoteBlocksApply:true,bootstrap,ptyResult,errors,noAgentCheckout:true,localInstallStarted:false};
  fs.writeFileSync(path.join(logs,'smoke.json'),JSON.stringify(result,null,2)+'\n');
  console.log('REAL NATIVE PACKAGED APP SMOKE:',JSON.stringify(result,null,2));
} finally {if(app)await app.close();}
