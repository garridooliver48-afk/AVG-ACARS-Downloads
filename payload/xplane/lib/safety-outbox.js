'use strict';
const fs=require('node:fs');
const path=require('node:path');
class SafetyOutbox {
  constructor({file,getSettings,request,onStatus=()=>{}}) {
    this.file=file;this.getSettings=getSettings;this.request=request;this.onStatus=onStatus;this.busy=false;
    // A damaged queue must be visible, never silently reset and erase evidence.
    if(fs.existsSync(file)) {
      this.items=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!Array.isArray(this.items))throw Error('Cola de evidencia inválida. Conserva el archivo y contacta a AVG-001.');
    } else this.items=[];
  }
  save(items) {
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const tmp=this.file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(items));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,this.file);this.items=items;
  }
  enqueue(event) {
    if(this.items.some(x=>x.flightId===event.flightId&&x.licenseNumber===event.licenseNumber&&x.apiBaseUrl===event.apiBaseUrl))return;
    this.save([...this.items,event]);
    this.onStatus('Posible accidente: evidencia guardada para revisión de AVG-001.');
    void this.flush();
  }
  async flush() {
    if(this.busy||!this.items.length)return;
    this.busy=true;
    try{
      const settings=this.getSettings();
      // Filter by the signed-in account where available; the server always verifies flight ownership.
      for(const event of [...this.items]) {
        if(event.apiBaseUrl!==settings.apiBaseUrl||
           (settings.licenseNumber&&event.licenseNumber!==settings.licenseNumber))continue;
        try{
          const {apiBaseUrl,...payload}=event;
          const response=await this.request(apiBaseUrl,settings.token,'/api/acars/safety','POST',payload);
          if(response.data?.status!=='received'||typeof response.data?.caseId!=='string')throw Error('Falta confirmación de AVG.');
          this.save(this.items.filter(x=>x.eventId!==event.eventId));
          this.onStatus('Evidencia de posible accidente recibida por AVG para revisión.');
        }catch(error){this.onStatus('Evidencia pendiente de envío. El ACARS reintentará al recuperar conexión o iniciar sesión.');break;}
      }
    }catch(error){this.onStatus('Hay evidencia guardada pendiente: inicia sesión para enviarla.');}
    finally{this.busy=false;}
  }
}
module.exports={SafetyOutbox};
