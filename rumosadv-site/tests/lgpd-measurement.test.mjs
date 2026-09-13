import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(process.env.LGPD_TEST_HTML || path.join(here,'../index.html'),'utf8');
const values={nome:'TESTE PESSOA FICTÍCIA',empresa:'TESTE EMPRESA SEM CLIENTE',motivo:'Exigência fictícia',prazo:'Somente ensaio',contexto:'TEXTO CONFIDENCIAL SINTÉTICO NÃO TRANSMITIR AO ANALYTICS'};
function boot(valid=true,search='?email=PESSOA-PRIVADA&gclid=IDENTIFICADOR-TESTE'){
 const listeners={link:[],submit:[],button:[]};
 const opened=[];
 const link={getAttribute:()=> 'hero',addEventListener:(_,f)=>listeners.link.push(f)};
 const buttons=['whatsapp','email'].map(value=>({value,addEventListener:(_,f)=>listeners.button.push({value,f})}));
 const form={querySelectorAll:()=>buttons,addEventListener:(_,f)=>listeners.submit.push(f),reportValidity:()=>valid};
 const status={textContent:''};
 const window={dataLayer:[],location:{href:'https://rumosadv.com.br/'+search+'#segredo',search},open:(...args)=>opened.push(args)};
 const ctx={window,document:{querySelectorAll:()=>[link],getElementById:id=>id==='lgpd-contact-form'?form:status},FormData:function(){this.get=k=>values[k];},String,encodeURIComponent,Object,Date,URLSearchParams};
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
   .filter(m=>!(/application\/ld\+json|\bsrc=/i.test(m[1]))).map(m=>m[2]);
 vm.createContext(ctx);
 scripts.forEach(code=>vm.runInContext(code,ctx));
 const commands=()=>window.dataLayer.map(x=>Array.from(x));
 const events=()=>commands().filter(x=>x[0]==='event');
 return {window,ctx,listeners,opened,status,commands,events};
}

test('home usa somente o GA4 próprio; scripts de hospedagem preexistentes são identificados',()=>{
 assert(!/GTM-NQTH2XWD|connect\.facebook|clarity\.ms|AW-\d+/.test(html));
 const remote=[...html.matchAll(/<script[^>]*src="([^\"]+)"/gi)].map(m=>m[1]);
 const ga=remote.filter(url=>/^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]+$/.test(url));
 assert.equal(ga.length,1);
 // Cloudflare injeta estes dois recursos na resposta, mas não no repositório.
 // A política de rede deles deve ser conferida nos cabeçalhos publicados, à parte.
 const edge=remote.filter(url=>url!==ga[0]);
 assert(edge.length<=2);
 for(const url of edge) assert(
  /^\/cdn-cgi\/scripts\/[a-f0-9]+\/cloudflare-static\/email-decode\.min\.js$/.test(url)||
  /^https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/v[a-f0-9]+$/.test(url),
  'Script adicional inesperado: '+url);
});
test('restrições publicitárias são enfileiradas antes da configuração',()=>{
 const {commands}=boot();const c=commands();
 assert.deepEqual(JSON.parse(JSON.stringify(c[0])),['consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}]);
 assert(!c.some(x=>x[0]==='consent'&&x[1]==='update'));
 assert(!JSON.stringify(c).includes('granted'));
 const cfg=c.find(x=>x[0]==='config');
 assert(cfg);assert.equal(cfg[2].send_page_view,false);
 assert.equal(cfg[2].allow_google_signals,false);
 assert.equal(cfg[2].allow_ad_personalization_signals,false);
 assert.equal(cfg[2].cookie_prefix,'rumos_lgpd');
 assert.equal(cfg[2].cookie_expires,86400);
});
test('uma visita gera um evento LGPD e nenhum page_view manual duplicado',()=>{
 const {events}=boot();assert.equal(events().length,1);
 assert.equal(events()[0][1],'lgpd_page_view');
});
test('clique direto tem origem e canal explícitos, sem duplicação',()=>{
 const b=boot(); b.listeners.link[0]();
 assert.equal(b.events().length,2);
 const p=b.events()[1][2]; assert.equal(p.source,'hero');assert.equal(p.channel,'whatsapp');
});
test('formulário inválido não emite handoff nem abre destino',()=>{
 const b=boot(false);b.listeners.submit[0]({preventDefault(){}});
 assert.equal(b.events().length,1);assert.equal(b.opened.length,0);
});
test('handoff WhatsApp preserva mensagem e não inclui conteúdo na mensuração',()=>{
 const b=boot();b.listeners.submit[0]({preventDefault(){}});
 assert.equal(b.opened.length,1);assert.equal(b.events().length,2);
 assert.equal(b.events()[1][1],'lgpd_handoff_intent');
 assert.equal(b.events()[1][2].source,'form');assert.equal(b.events()[1][2].channel,'whatsapp');
 const url=new URL(b.opened[0][0]);assert.equal(url.hostname,'wa.me');
 assert.equal(url.pathname,'/5519994864268');
 assert(url.searchParams.get('text').includes(values.contexto));
 Object.values(values).forEach(v=>assert(!JSON.stringify(b.commands()).includes(v)));
});
test('preparação de e-mail mantém canal correto sem enviar mensagem',()=>{
 const b=boot();b.listeners.button.find(x=>x.value==='email').f();
 b.listeners.submit[0]({preventDefault(){}});
 assert.equal(b.events()[1][2].channel,'email');assert.equal(b.opened.length,0);
 assert.match(b.window.location.href,/^mailto:rodrigo@rumosadv\.com\.br\?/);
});
test('campos extras, origem arbitrária e evento não permitido não vazam',()=>{
 const b=boot();b.window.rumosLgpdSend({event:'segredo',source:'segredo'});
 assert.equal(b.events().length,1);
 b.window.rumosLgpdSend({event:'lgpd_whatsapp_intent',source:values.nome,channel:values.contexto,contexto:values.contexto,user_id:'ID-CLIENTE',page_location:'URL-PRIVADA'});
 const p=b.events()[1][2];assert.equal(p.source,'other');assert(!('channel' in p));
 assert(!('contexto' in p));assert(!('user_id' in p));
 assert.equal(p.page_location,'https://rumosadv.com.br/');
 Object.values(values).forEach(v=>assert(!JSON.stringify(b.commands()).includes(v)));
});
test('destino e URL da mensuração são limitados mesmo com query sensível',()=>{
 const b=boot();b.listeners.link[0]();const cfg=b.commands().find(x=>x[0]==='config');
 for(const e of b.events()){
  assert.equal(e[2].send_to,cfg[1]);assert.equal(e[2].page,'home-lgpd');
  assert.equal(e[2].page_location,'https://rumosadv.com.br/');assert.equal(e[2].page_referrer,'');
 }
 assert(!/PESSOA-PRIVADA|IDENTIFICADOR-TESTE|#segredo|wa\.me|mailto:/.test(JSON.stringify(b.commands())));
});
test('falha/bloqueio da biblioteca remota não quebra o formulário',()=>{
 const b=boot();delete b.window.rumosLgpdSend;
 assert.doesNotThrow(()=>b.listeners.submit[0]({preventDefault(){}}));
 assert.equal(b.opened.length,1);
});
test('campanha usa apenas rótulos fixos autorizados, sem copiar parâmetros arbitrários',()=>{
 const b=boot(true,'?utm_source=google&utm_medium=cpc&utm_campaign=RUM-LGPD-Search-BR-V1&gclid=ID-PRIVADO');
 const c=b.commands().find(x=>x[0]==='set'&&x[1].campaign_source);
 assert(c);assert.equal(c[1].campaign_source,'google');assert.equal(c[1].campaign_medium,'cpc');
 assert.equal(c[1].campaign_name,'RUM-LGPD-Search-BR-V1');
 assert(!JSON.stringify(b.commands()).includes('ID-PRIVADO'));
 const other=boot(true,'?utm_source=CLIENTE-PRIVADO&utm_medium=cpc&utm_campaign=RUM-LGPD-Search-BR-V1');
 assert(!other.commands().some(x=>x[0]==='set'&&x[1].campaign_source));
 assert(!JSON.stringify(other.commands()).includes('CLIENTE-PRIVADO'));
});
