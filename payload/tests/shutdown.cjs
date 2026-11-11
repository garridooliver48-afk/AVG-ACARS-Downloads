const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {createShutdown}=require('../msfs/lib/shutdown');
test('cierre: para reconexion, desconecta y destruye overlay oculto; es idempotente',()=>{
 const events=[];const window={isDestroyed:()=>false,destroy:()=>events.push('overlay')};
 const stop=createShutdown({getEngine:()=>({stopAuto:x=>events.push(['stop',x]),disconnect:x=>events.push(['disconnect',x])}),
 stopBackground:()=>events.push('timers'),getWindows:()=>[window]});stop();stop();
 assert.deepEqual(events,['timers',['stop',{disconnect:false}],['disconnect',{silent:true}],'overlay']);
});
test('cierre: errores de SimConnect no impiden cerrar ventanas',()=>{
 let destroyed=false;const stop=createShutdown({getEngine:()=>({stopAuto:()=>{throw Error('socket');},disconnect:()=>{throw Error('socket');}}),
 stopBackground:()=>{},getWindows:()=>[{isDestroyed:()=>false,destroy:()=>{destroyed=true;}}]});stop();assert.equal(destroyed,true);
});
test('principal: cerrar con X y confirmar termina el ACARS aunque exista el overlay',async()=>{
 const {EventEmitter}=require('events');const app=new EventEmitter();const windows=[];let quit=0,stopped=0,disconnected=0,cleared=0;
 app.getPath=()=>'/tmp/avg-test';app.setPath=()=>{};app.setAppUserModelId=()=>{};app.requestSingleInstanceLock=()=>true;
 let init;app.whenReady=()=>({then:fn=>{init=fn;}});app.quit=()=>{quit++;app.emit('before-quit');};
 class Window extends EventEmitter{
 constructor(){super();this.destroyed=false;this.webContents=new EventEmitter();this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}
 static getAllWindows(){return windows.filter(w=>!w.destroyed);}
 isDestroyed(){return this.destroyed;}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 loadFile(){} removeMenu(){} show(){}setIgnoreMouseEvents(){}setAlwaysOnTop(){}setPosition(){}
 }
 let engine;
 class Engine{constructor(){engine=this;this.track=null;}stopAuto(){stopped++;}disconnect(){disconnected++;this.track=null;}}
 const modules={'electron':{app,BrowserWindow:Window,ipcMain:{handle:()=>{}},safeStorage:{},shell:{},dialog:{showMessageBoxSync:()=>1},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1000}})}},
 'node:fs':{mkdirSync:()=>{},readFileSync:()=>{throw Error('missing');}},'node:path':require('path'),
 './lib/network':{},'./lib/engine':{FlightEngine:Engine},'./lib/safety-outbox':{SafetyOutbox:class{flush(){}}},'./lib/shutdown':{createShutdown}};
 vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../msfs/main.js'),'utf8'),{require:id=>modules[id],__dirname:'/app',
 setInterval:()=>({unref(){}}),clearInterval:()=>{cleared++;},clearTimeout:()=>{},setTimeout:()=>{},process:{platform:'win32'}});
 await init();assert.equal(windows.length,2);engine.track={flightId:'active'};
 let prevented=false;windows[0].emit('close',{preventDefault:()=>{prevented=true;}});assert.equal(prevented,false);
 windows[0].destroy();assert.ok(quit>=1);assert.equal(stopped,1);assert.equal(disconnected,1);assert.equal(cleared,1);assert.equal(Window.getAllWindows().length,0);
});
