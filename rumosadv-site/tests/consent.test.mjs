import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const site = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(path.join(site, 'assets/consent.v1.js'), 'utf8');
function runtime(saved, host='rumosadv.com.br', brokenStorage=false) {
  const elements=new Map(), scripts=[], events={}, removed=[], store=new Map();
  if(saved!==undefined) store.set('rumos_privacy_v1', typeof saved==='string'?saved:JSON.stringify(saved));
  function element(tag='div') {
    const e={tagName:tag, dataset:{}, hidden:false, checked:false, isConnected:true, listeners:{}, children:[], setAttribute(){}, focus(){}, addEventListener(name,fn){this.listeners[name]=fn;}, appendChild(child){this.children.push(child);if(child.tagName==='script')scripts.push(child.src);if(child.id)elements.set(child.id,child);}, get innerHTML(){return '';}, set innerHTML(html){for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],element());}};
    return e;
  }
  const document={head:element('head'),body:element('body'),documentElement:element('html'),activeElement:null,readyState:'loading',createElement:element,getElementById(id){return elements.get(id);},querySelector(){return null;},addEventListener(name,fn){events[name]=fn;}};
  Object.defineProperty(document,'cookie',{get(){return '_ga=one; _fbp=two; session=keep';},set(v){removed.push(v);}});
  const window={dataLayer:[],addEventListener(name,fn){events[name]=fn;}};
  const location={hostname:host,reloads:0,reload(){this.reloads++;}};
  const localStorage={getItem(k){if(brokenStorage)throw Error('denied');return store.get(k)||null;},setItem(k,v){if(brokenStorage)throw Error('denied');store.set(k,v);}};
  vm.runInNewContext(source,{window,document,location,localStorage,Date,JSON,Number,Object});
  window.dataLayer.push({event:'whatsapp_click',source:'before-consent'});
  events.DOMContentLoaded();
  return {window,document,elements,scripts,location,store,removed,click(id){elements.get(id).listeners.click();}};
}
const saved=(analytics,marketing)=>({version:1,at:Date.now(),analytics,marketing});
test('first visit and rejection never load trackers or replay prior clicks',()=>{
  const r=runtime();assert.equal(r.scripts.length,0);assert.equal(r.elements.get('rumos-consent').hidden,false);
  r.click('rumos-cookie-reject');assert.equal(r.scripts.length,0);assert.equal(r.document.documentElement.dataset.consentMarketing,'denied');
  assert.equal(JSON.parse(r.store.get('rumos_privacy_v1')).marketing,false);
});
test('grant loads GTM once, updates all v2 flags and drops pre-consent events',()=>{
  const r=runtime();r.click('rumos-cookie-accept');r.click('rumos-cookie-accept');assert.equal(r.scripts.length,1);
  assert.equal(r.window.dataLayer.some(x=>x.event==='whatsapp_click'),false);
  const update=r.window.dataLayer.filter(x=>x[0]==='consent'&&x[1]==='update').at(-1)[2];
  for(const key of ['ad_storage','ad_user_data','ad_personalization','analytics_storage'])assert.equal(update[key],'granted');
});
test('analytics-only and marketing-only choices retain independent consent',()=>{
  for(const [a,m] of [[true,false],[false,true]]){const r=runtime(saved(a,m));assert.equal(r.scripts.length,1);assert.equal(r.window['ga-disable-G-SM1QE14GF3'],!a);const update=r.window.dataLayer.filter(x=>x[0]==='consent'&&x[1]==='update').at(-1)[2];assert.equal(update.analytics_storage,a?'granted':'denied');assert.equal(update.ad_storage,m?'granted':'denied');}
});
test('revocation clears known optional cookies, preserves essential names and reloads',()=>{
  const r=runtime(saved(true,true));r.click('rumos-cookie-reject');assert.equal(r.location.reloads,1);assert.ok(r.removed.some(x=>x.startsWith('_ga=')));assert.ok(r.removed.some(x=>x.startsWith('_fbp=')));assert.equal(r.removed.some(x=>x.startsWith('session=')),false);
});
test('invalid, expired or inaccessible storage stays denied',()=>{
  for(const item of ['broken-json',{...saved(true,true),at:Date.now()-181*86400000},{...saved(true,true),version:9}])assert.equal(runtime(item).scripts.length,0);
  const r=runtime(undefined,'rumosadv.com.br',true);r.click('rumos-cookie-reject');assert.equal(r.scripts.length,0);
});
test('local and preview pages never transmit measurement even after acceptance',()=>{
  for(const host of ['localhost','127.0.0.1','preview-inventario-videos.rumosadv-git.pages.dev']){const r=runtime(undefined,host);r.click('rumos-cookie-accept');assert.equal(r.scripts.length,0);}
});
test('public HTML has one consent bootstrap and no direct tracker or no-JS bypass',()=>{
  function scan(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory()){if(!['admin','aceite','briefing'].includes(item.name))scan(p);}else if(item.name.endsWith('.html')){const text=readFileSync(p,'utf8');assert.equal((text.match(/src="\/assets\/consent\.v1\.js"/g)||[]).length,1,p);assert.doesNotMatch(text, /googletagmanager\.com\/(gtm\.js|ns\.html)|clarity\.ms\/tag\//,p);}}}
  scan(site);
});
