// Exposes a small, origin-gated API to Lethe's own internal pages only.
const { contextBridge, ipcRenderer, webFrame } = require('electron');
let origin = '';
try { origin = ipcRenderer.sendSync('lethe:origin'); } catch { /* ignore */ }
if (origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('lethe', {
    call: (name, arg) => ipcRenderer.invoke('lethe:call', name, arg),
    onTheme: cb => ipcRenderer.on('lethe:theme', (_e, t) => cb(t))
  });
}

// When a non-default user agent is chosen, keep the other navigator fields consistent with it.
if (/^https?:$/.test(location.protocol)) {
  let info = null;
  try { info = ipcRenderer.sendSync('lethe:uaInfo', location.hostname); } catch { /* ignore */ }
  if (info) {
    const def = (k, v) => `Object.defineProperty(Navigator.prototype,${JSON.stringify(k)},{get:()=>${JSON.stringify(v)},configurable:true});`;
    webFrame.executeJavaScript(
      def('userAgent', info.ua) + def('platform', info.platform) + def('vendor', info.vendor) + def('appVersion', info.ua.replace(/^Mozilla\//, '')) +
      (info.hideCH ? 'Object.defineProperty(Navigator.prototype,"userAgentData",{get:()=>undefined,configurable:true});' : '') +
      (info.chromeMajor ? `(()=>{const V=${JSON.stringify(String(info.chromeMajor))},P=${JSON.stringify(info.chPlatform)},M=${!!info.mobile};const brands=[{brand:"Chromium",version:V},{brand:"Google Chrome",version:V},{brand:"Not_A Brand",version:"24"}];const d={brands,mobile:M,platform:P,getHighEntropyValues:async()=>({brands,mobile:M,platform:P,platformVersion:"",architecture:"",bitness:"",model:"",uaFullVersion:V+".0.0.0"}),toJSON(){return{brands,mobile:M,platform:P}}};Object.defineProperty(Navigator.prototype,"userAgentData",{get:()=>d,configurable:true});})();` : '')
    );
  }
}

// On duckduckgo.com only: report the same user agent the DuckDuckGo browser reports, so the site
// sees an existing DuckDuckGo-browser user and skips its "get our browser" promotions.
if (/(^|\.)duckduckgo\.com$/.test(location.hostname)) {
  let ua = '';
  try { ua = ipcRenderer.sendSync('lethe:ddgHint'); } catch { /* ignore */ }
  if (ua) {
    webFrame.executeJavaScript(
      `Object.defineProperty(Navigator.prototype,'userAgent',{get:()=>${JSON.stringify(ua)},configurable:true});` +
      `Object.defineProperty(Navigator.prototype,'appVersion',{get:()=>${JSON.stringify(ua.replace(/^Mozilla\//, ''))},configurable:true});`
    );
  }
}
