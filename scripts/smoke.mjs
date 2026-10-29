import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const [source,binary,home,logs]=process.argv.slice(2);
assert(source&&binary&&home&&logs,'Usage: smoke.mjs source binary isolatedHome logs');
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(source,'apps/desktop/package.json'));
const {_electron}=require('playwright');
assert.equal(fs.existsSync(path.join(home,'.hermes')),false,'Smoke HOME must be fresh');

// This step must always end. A renderer->main IPC that never settles (the app
// awaits a backend before replying to some channels) would otherwise block the
// whole job until the workflow timeout, so every await is bounded here and a
// watchdog dumps diagnostics and fails the step instead.
const WATCHDOG_MS=330000;
const watchdog=setTimeout(()=>{
  console.error(`SMOKE WATCHDOG: no result after ${WATCHDOG_MS}ms`);
  process.exit(9);
},WATCHDOG_MS);
watchdog.unref?.();

const withTimeout=(promise,ms,label)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${label} did not settle within ${ms}ms`)),ms);
  promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
});

const env={...process.env};
env.PATH=process.platform==='win32'?path.join(env.SystemRoot||env.SYSTEMROOT||'C:\\Windows','System32'):'/usr/bin:/bin:/usr/sbin:/sbin';
const args=['--user-data-dir='+path.join(home,'u'),'--enable-logging=stderr'];
// Linux CI: run under xvfb when available; the headless ozone path segfaults on
// Electron 44 in hosted runners, so it is only a fallback without a display.
if(process.platform==='linux'&&process.env.HERMES_SMOKE_HEADLESS==='1'){delete env.DISPLAY;delete env.XAUTHORITY;args.push('--disable-gpu','--no-sandbox','--ozone-platform=headless');}

const errors=[];
const diagnostics=[];
let app;
let page;
const snapshot=async tag=>{
  try{
    const info=await withTimeout(page.evaluate(()=>({url:location.href,text:document.body?document.body.innerText.slice(0,4000):null})),15000,'snapshot '+tag);
    diagnostics.push({tag,...info});
  }catch(error){
    diagnostics.push({tag,error:String(error)});
  }
};
const flushDiagnostics=()=>{
  try{fs.writeFileSync(path.join(logs,'smoke-diagnostics.json'),JSON.stringify({diagnostics,errors},null,2)+'\n');}catch{}
};
try {
  app=await withTimeout(_electron.launch({executablePath:binary,args,env,timeout:90000}),120000,'launch');
  page=await withTimeout(app.firstWindow({timeout:60000}),90000,'firstWindow');
  page.on('pageerror',error=>errors.push(String(error)));
  await withTimeout(page.getByText('Install Hermes locally',{exact:true}).waitFor({timeout:60000}),90000,'install offer');
  fs.writeFileSync(path.join(logs,'install-offer.txt'),await withTimeout(page.locator('body').innerText(),30000,'install offer text'));
  // Stock upstream first run offers both paths; this build ships it unpatched,
  // so the remote form is reached by choosing it, once.
  await withTimeout(page.getByRole('button',{name:/Connect to existing Hermes/}).first().click(),30000,'choose remote');
  await withTimeout(page.getByRole('heading',{name:'Connect to existing Hermes',exact:true}).waitFor({timeout:60000}),90000,'remote heading');
  await withTimeout(page.getByPlaceholder('https://gateway.example.com/hermes').waitFor({timeout:60000}),90000,'gateway field');
  fs.writeFileSync(path.join(logs,'first-run.txt'),await withTimeout(page.locator('body').innerText(),30000,'remote form text'));
  // Main process facts first: these settle immediately. The renderer's
  // hermesDesktop.getVersion channel is deliberately not used here — before a
  // backend exists it stays pending (upstream awaits backend resolution), and
  // the packaged version is asserted from the main process instead.
  const paths=await withTimeout(app.evaluate(({app})=>({packaged:app.isPackaged,path:app.getAppPath(),resources:process.resourcesPath,home:app.getPath('home'),userData:app.getPath('userData'),hermesHome:process.env.HERMES_HOME,platform:process.platform,arch:process.arch,electronVersion:process.versions.electron,nodeVersion:process.versions.node})),30000,'main process facts');
  assert.equal(paths.packaged,true);
  assert.equal(paths.platform,process.platform);
  assert.equal(paths.arch,process.arch);
  assert.equal(paths.hermesHome,path.join(home,'.hermes'));
  const installStamp=JSON.parse(fs.readFileSync(path.join(paths.resources,'install-stamp.json'),'utf8'));
  const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.json'),'utf8'));
  assert.match(pin.version,/^\d+(?:\.\d+)+$/);
  // Upstream trees carry a 0.0.0 placeholder; this pipeline injects the pinned
  // release version at pack time, so the running app must report it.
  const runtimeDesktopVersion=await withTimeout(app.evaluate(({app})=>app.getVersion()),20000,'main process version');
  assert.notEqual(installStamp.distribution,'frankhommers-homebrew');
  assert.equal(installStamp.distributionVersion,undefined);
  assert.equal(runtimeDesktopVersion,pin.version);
  const bootstrap=await withTimeout(page.evaluate(()=>window.hermesDesktop.getBootstrapState()),20000,'bootstrap state');
  assert.equal(bootstrap.active,false);
  assert.equal(bootstrap.manifest,null);
  assert.deepEqual(bootstrap.stages,{});
  // Stock upstream leaves setupChoice null until a bootstrap is ready; it must
  // never claim a local install was started by merely opening the app.
  if(bootstrap.setupChoice)assert.equal(bootstrap.setupChoice.local,'none');
  fs.writeFileSync(path.join(logs,'remote-form.txt'),await withTimeout(page.locator('body').innerText(),30000,'remote form snapshot'));
  const remoteProbe=await withTimeout(page.evaluate(url=>window.hermesDesktop.probeConnectionConfig(url),'http://127.0.0.1:9'),30000,'native connection probe');
  assert.equal(remoteProbe.reachable,false);
  assert(remoteProbe.error,'Actual native IPC/network probe must return an error');
  const applyButton=page.getByRole('button',{name:'Apply and reconnect',exact:true});
  if(await applyButton.count())assert.equal(await applyButton.isDisabled(),true);
  fs.writeFileSync(path.join(logs,'unreachable-remote.txt'),await withTimeout(page.locator('body').innerText(),30000,'unreachable remote snapshot'));
  const ptyResult=await withTimeout(app.evaluate(async({app})=>{
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
  }),40000,'native pty');
  assert.equal(ptyResult.exitCode,0);
  assert(ptyResult.output.includes('HERMES_NATIVE_PTY_OK'));
  const after=await withTimeout(page.evaluate(()=>window.hermesDesktop.getBootstrapState()),20000,'bootstrap state after probe');
  assert.equal(after.active,false);assert.deepEqual(after.stages,{});
  assert(!fs.existsSync(path.join(home,'.hermes/hermes-agent')),'No local agent checkout');
  assert.equal(errors.length,0,JSON.stringify(errors));
  const result={platform:process.platform,arch:process.arch,paths,installStamp,runtimeDesktopVersion,pinVersion:pin.version,firstRun:true,remoteForm:true,remoteSetupOpened:true,installOfferShown:true,unreachableRemoteBlocksApply:true,bootstrap,remoteProbe,ptyResult,errors,noAgentCheckout:true,localInstallStarted:false};
  fs.writeFileSync(path.join(logs,'smoke.json'),JSON.stringify(result,null,2)+'\n');
  console.log('REAL NATIVE PACKAGED APP SMOKE:',JSON.stringify(result,null,2));
} catch (error) {
  await snapshot('failure');
  flushDiagnostics();
  throw error;
} finally {
  clearTimeout(watchdog);
  if(app){
    // A dead app or an orphaned renderer can leave close() waiting forever.
    try{await withTimeout(app.close(),20000,'app.close');}
    catch(error){
      diagnostics.push({tag:'close',error:String(error)});
      flushDiagnostics();
      try{app.process()?.kill('SIGKILL');}catch{}
    }
  }
}
