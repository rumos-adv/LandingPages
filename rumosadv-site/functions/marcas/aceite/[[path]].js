class CheckoutScriptInjector {
  element(element) {
    element.append(`
<script>
(function(){
  const form=document.getElementById('accept-form');
  if(!form) return;
  // Captura o submit antes do listener legado para executar o fluxo completo aceite -> checkout.
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    const status=document.getElementById('form-status');
    const term=document.getElementById('term-text');
    const button=form.querySelector('button[type="submit"]');
    status.className='status'; status.textContent='';
    button.disabled=true; button.textContent='Registrando aceite...';
    try {
      const text=term.innerText.trim();
      const bytes=new TextEncoder().encode(text);
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const termHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
      const payload={
        nome:form.nome.value.trim(), cpf_cnpj:form.cpf_cnpj.value.trim(),
        email:form.email.value.trim(), whatsapp:form.whatsapp.value.trim(),
        marca:form.marca.value.trim(), consent:document.getElementById('consent').checked,
        term_version:term.dataset.version, term_hash:termHash
      };
      const accepted=await fetch('/api/aceites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const acceptance=await accepted.json();
      if(!accepted.ok) throw new Error(acceptance.error||'Não foi possível registrar o aceite.');
      window.dataLayer=window.dataLayer||[];
      window.dataLayer.push({event:'analise_viabilidade_aceite',aceite_id:acceptance.id});
      status.className='status ok'; status.innerHTML='<strong>Aceite registrado.</strong> Abrindo o pagamento seguro…';
      button.textContent='Abrindo pagamento…';
      const checkoutRes=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aceite_id:acceptance.id})});
      const checkout=await checkoutRes.json();
      if(!checkoutRes.ok || !checkout.checkout_url) throw new Error(checkout.error||'Não foi possível iniciar o pagamento.');
      window.dataLayer.push({event:'asaas_checkout_created',aceite_id:acceptance.id,checkout_id:checkout.checkout_id});
      window.location.assign(checkout.checkout_url);
    } catch(err) {
      status.className='status error'; status.textContent=err.message+' Tente novamente em instantes.';
      button.disabled=false; button.textContent='Contratar análise — R$ 390';
    }
  }, true);
})();
</script>`, {html:true});
  }
}

export async function onRequest(context) {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  return new HTMLRewriter().on('body', new CheckoutScriptInjector()).transform(response);
}
