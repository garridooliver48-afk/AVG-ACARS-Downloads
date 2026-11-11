'use strict';
// All pending reports/evidence are written synchronously by their existing stores.
// Closing the main window must also close the hidden overlay and network readers.
function createShutdown({getEngine,stopBackground,getWindows}) {
  let stopped=false;
  return function shutdown() {
    if(stopped)return;
    stopped=true;
    try{stopBackground();}catch{}
    const engine=getEngine();
    try{engine?.stopAuto({disconnect:false});}catch{}
    try{engine?.disconnect({silent:true});}catch{}
    for(const window of getWindows()) {
      try{if(!window.isDestroyed())window.destroy();}catch{}
    }
  };
}
module.exports={createShutdown};
