/* Gerador do contrato da etapa administrativa (recuperação de conta de WhatsApp).
   Roda no navegador do painel, com a biblioteca pdf-lib. Os dados digitados não saem da
   página até o envio para assinatura. Texto-base: minuta de 12/11/2026. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('pdf-lib'));
  else root.RumosContrato = factory(root.PDFLib);
})(typeof self !== 'undefined' ? self : this, function (PDFLib) {
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  var clean = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  function fmtDoc(s) { var d = digits(s);
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return clean(s); }
  function fmtFone(s) { var d = digits(s).replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return clean(s); }
  function dataExtenso(d) { return d.getDate() + (d.getDate() === 1 ? 'º' : '') + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
  function dataBR(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : clean(s); }

  // Confere os dados e devolve a lista do que falta. Lista vazia = pode gerar.
  function validar(d) {
    var f = [], pj = d.tipo === 'pj', need = function (k, label) { if (!clean(d[k])) f.push(label); };
    need('nome', pj ? 'Razão social' : 'Nome completo');
    if (digits(d.cpf_cnpj).length !== (pj ? 14 : 11)) f.push(pj ? 'CNPJ com 14 dígitos' : 'CPF com 11 dígitos');
    if (pj) { need('rep_nome', 'Nome do representante'); need('rep_cargo', 'Cargo do representante'); if (digits(d.rep_cpf).length !== 11) f.push('CPF do representante'); }
    else { need('nacionalidade', 'Nacionalidade'); need('estado_civil', 'Estado civil'); need('profissao', 'Profissão'); }
    need('endereco', pj ? 'Endereço da sede' : 'Endereço completo'); need('email', 'E-mail'); need('whatsapp', 'WhatsApp');
    need('plataforma', 'Plataforma'); need('conta_numero', 'Número da conta afetada'); need('ocorrencia', 'Tipo de ocorrência'); need('data_fato', 'Data em que percebeu'); need('proposta_numero', 'Número da proposta');
    return f;
  }

  function blocos(d) {
    var pj = d.tipo === 'pj', nome = clean(d.nome).toUpperCase(), doc = fmtDoc(d.cpf_cnpj), fone = fmtFone(d.whatsapp);
    var plat = { 'WhatsApp': 'WhatsApp', 'WhatsApp Business': 'WhatsApp Business', 'WhatsApp Business Platform (API)': 'WhatsApp Business Platform' }[d.plataforma] || clean(d.plataforma);
    var qual = pj
      ? '**CONTRATANTE:** ' + nome + ', CNPJ nº ' + doc + ', com sede em ' + clean(d.endereco) + ', e-mail ' + clean(d.email) + ', telefone ' + fone + ', neste ato representada por ' + clean(d.rep_nome) + ', ' + clean(d.rep_cargo) + ', CPF nº ' + fmtDoc(d.rep_cpf) + '.'
      : '**CONTRATANTE:** ' + nome + ', ' + clean(d.nacionalidade) + ', ' + clean(d.estado_civil) + ', ' + clean(d.profissao) + ', CPF nº ' + doc + ', residente e domiciliado(a) em ' + clean(d.endereco) + ', e-mail ' + clean(d.email) + ', telefone ' + fone + '.';
    var medicao = d.opoe_medicao
      ? '§ 4º. O(a) CONTRATANTE manifestou oposição ao envio de informações sobre esta contratação a plataformas de anúncios para fins de medição de publicidade. Nenhum envio dessa natureza será feito.'
      : '§ 4º. Se o(a) CONTRATANTE chegou ao escritório por anúncio, a CONTRATADA pode informar à plataforma de anúncios, apenas por meio do identificador técnico do clique, a ocorrência da contratação e o valor dos honorários, para medir o resultado de sua publicidade. Não são enviados nome, telefone, e-mail ou qualquer informação sobre o caso. O(a) CONTRATANTE pode se opor a esse envio a qualquer tempo, pelo canal oficial, sem qualquer efeito sobre este contrato.';
    var P = function (t) { return { k: 'p', t: t }; }, H = function (t) { return { k: 'h', t: t }; }, L = function (t) { return { k: 'li', t: t }; };
    return [
      { k: 'title', t: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS' }, { k: 'sub', t: 'Etapa administrativa — Recuperação de conta de WhatsApp' },
      H('Qualificação das partes'), P(qual),
      P('**CONTRATADA:** RODRIGO MOURA SILVA SOCIEDADE INDIVIDUAL DE ADVOCACIA (nome fantasia Rumos Advocacia), CNPJ nº 68.258.534/0001-56, registrada na OAB/SP em 24/04/2026, representada por seu sócio único e administrador, o advogado RODRIGO MOURA SILVA, OAB/SP nº 188.004, com endereço profissional no Condomínio Alphapark Tower, Campinas/SP, e-mail rodrigo@rumosadv.com.br.'),
      P('As partes ajustam o presente contrato, regido pela Lei nº 8.906/1994 e pelo Código de Ética e Disciplina da OAB, conforme a Proposta nº ' + clean(d.proposta_numero) + ', que o integra.'),
      H('Cláusula 1ª — Objeto'),
      P('A CONTRATADA prestará serviços advocatícios na via administrativa, visando ao restabelecimento da conta do(a) CONTRATANTE no ' + plat + ', vinculada ao número ' + fmtFone(d.conta_numero) + ', em razão de ' + clean(d.ocorrencia) + ' percebido(a) em ' + dataBR(d.data_fato) + '.'),
      P('§ 1º. O serviço compreende:'),
      P('(i) análise jurídica do bloqueio, das comunicações recebidas e das políticas da plataforma aplicáveis ao caso;'),
      P('(ii) organização das informações e das provas fornecidas pelo(a) CONTRATANTE;'),
      P('(iii) as providências administrativas que a CONTRATADA considerar tecnicamente cabíveis, como pedido de revisão instruído, notificação à plataforma e reclamação nos canais pertinentes;'),
      P('(iv) acompanhamento das respostas por 30 dias, contados da última providência;'),
      P('(v) orientações preventivas para o uso da conta; e'),
      P('(vi) relatório final com as providências adotadas, as respostas recebidas e a avaliação dos próximos passos, inclusive sobre a viabilidade da via judicial.'),
      P('§ 2º. Não estão compreendidos, salvo contratação escrita própria: ação judicial de qualquer natureza; outras contas, números ou fatos; questões criminais; disputa de titularidade ou de administração da conta ou da linha telefônica; serviços técnicos de aparelho, linha ou aplicativo.'),
      P('§ 3º. A CONTRATADA pode concluir, na análise do item (i), que não há providência administrativa útil. Nesse caso, entrega o relatório do item (vi) com essa conclusão e a orientação cabível.'),
      P('§ 4º. Verificações de identidade, confirmações e acessos exigidos pela plataforma são feitos pelo(a) próprio(a) CONTRATANTE, nos canais oficiais, com orientação da CONTRATADA.'),
      H('Cláusula 2ª — Honorários e pagamento'),
      P('Pelos serviços da Cláusula 1ª são devidos honorários fixos de R$ 500,00 (quinhentos reais).'),
      P('§ 1º. Pagamento por Pix ou cartão de crédito, à vista ou em até 3 parcelas no cartão, pela página de pagamento do Asaas (instituição de pagamento autorizada pelo Banco Central), liberada ao(à) CONTRATANTE após a assinatura deste contrato. O comprovante do Asaas vale como recibo; a CONTRATADA emite recibo próprio quando solicitado. Os pagamentos são recebidos em conta de titularidade de Rodrigo Moura Silva, sócio titular da CONTRATADA, que a CONTRATADA indica para esse fim; o pagamento feito nessa conta quita os honorários perante a CONTRATADA. Se a página de pagamento estiver indisponível, o pagamento pode ser feito por Pix à chave rodrigo@rumosadv.com.br, da mesma titularidade, mediante confirmação prévia pelo canal oficial.'),
      P('§ 2º. A assinatura deste contrato formaliza a contratação. A confirmação do pagamento marca o início dos trabalhos, que compreendem desde logo o atendimento, o estudo do caso e a análise dos documentos.'),
      P('§ 3º. Os honorários não dependem do resultado. Iniciados os trabalhos, não há restituição, porque o valor remunera os serviços já prestados, ressalvada a Cláusula 6ª, § 3º.'),
      P('§ 4º. **Abatimento na etapa judicial.** Se, em até 90 dias da entrega do relatório final, o(a) CONTRATANTE contratar a CONTRATADA para ação judicial sobre a mesma conta e os mesmos fatos, os R$ 500,00 pagos serão abatidos dos honorários fixos da etapa judicial, conforme proposta e contrato próprios. O abatimento não se aplica a honorários de êxito, custas ou despesas.'),
      P('§ 5º. Despesas como ata notarial ou taxas só são realizadas com autorização prévia do(a) CONTRATANTE e correm por sua conta.'),
      H('Cláusula 3ª — Início e prazos'),
      P('§ 1º. Os trabalhos começam com a confirmação do pagamento, após a assinatura deste contrato, e com o recebimento das informações essenciais: número afetado, mensagem exibida pela plataforma e histórico das tentativas anteriores.'),
      P('§ 2º. A primeira providência administrativa cabível será adotada em até 5 dias úteis do recebimento das informações essenciais, salvo se depender de ato do(a) CONTRATANTE.'),
      P('§ 3º. Mensagens recebidas de segunda a sexta, das 9h às 18h (horário de Brasília), são respondidas no mesmo dia útil; as demais, no dia útil seguinte.'),
      H('Cláusula 4ª — Obrigações da CONTRATADA'),
      L('Atuar com zelo e técnica, sob responsabilidade pessoal do advogado em todos os atos jurídicos.'), L('Manter sigilo profissional.'), L('Informar cada providência adotada e cada resposta recebida.'), L('Entregar o relatório final.'),
      L('**Nunca** solicitar senha, código de verificação, código de recuperação, QR de sessão ou acesso remoto ao aparelho do(a) CONTRATANTE.'),
      H('Cláusula 5ª — Obrigações do(a) CONTRATANTE'),
      L('Informar os fatos com verdade, inclusive os desfavoráveis, como uso de aplicativos não oficiais, mensagens em massa ou automações.'),
      L('Preservar os originais de avisos, e-mails e mensagens; não editar capturas de tela.'),
      L('Realizar as verificações exigidas pela plataforma quando orientado.'),
      L('Comunicar imediatamente: recuperação da conta, nova comunicação da plataforma, criação de outra conta, contratação de terceiro para o mesmo fim ou mudança de contato.'),
      L('Pagar os honorários e as despesas autorizadas.'),
      H('Cláusula 6ª — Encerramento'),
      P('§ 1º. O contrato se encerra com a entrega do relatório final ou com o restabelecimento da conta, o que ocorrer primeiro. Restabelecida a conta, nada mais é devido além dos honorários desta etapa.'),
      P('§ 2º. A ausência de resposta da plataforma no período de acompanhamento não prorroga o contrato; o relatório registrará essa situação.'),
      P('§ 3º. Qualquer parte pode rescindir o contrato por escrito. Na rescisão por culpa da CONTRATADA, é restituída a parcela correspondente às atividades não concluídas com proveito.'),
      H('Cláusula 7ª — Canal oficial e prevenção a fraudes'),
      P('§ 1º. O canal oficial escolhido pelo(a) CONTRATANTE é o WhatsApp nº ' + fone + ', com o e-mail ' + clean(d.email) + ' como alternativa. Os remetentes oficiais da CONTRATADA são o WhatsApp (19) 98911-9770 e o e-mail rodrigo@rumosadv.com.br.'),
      P('§ 2º. A CONTRATADA não pede depósito para liberar contas ou valores, nem envia cobrança por contato diferente dos indicados. Em caso de dúvida, o(a) CONTRATANTE deve confirmar pelo WhatsApp oficial antes de pagar ou informar dados.'),
      P('§ 3º. Rotinas de atendimento e acompanhamento podem ser executadas por sistemas automatizados do escritório, identificados como tais, sob supervisão do advogado.'),
      H('Cláusula 8ª — Confidencialidade, dados pessoais e medição de publicidade'),
      P('§ 1º. A CONTRATADA trata os dados pessoais do(a) CONTRATANTE para executar este contrato, nos termos da Lei nº 13.709/2018, pelo tempo necessário a essa finalidade e aos prazos legais.'),
      P('§ 2º. O tratamento pode envolver fornecedores de hospedagem, mensagens, assinatura eletrônica, pagamento e ferramentas de inteligência artificial usadas para organizar e resumir informações, sempre sob revisão do advogado, conforme o aviso de privacidade em rumosadv.com.br/politica-de-privacidade.'),
      P('§ 3º. Documentos, mensagens e fatos do caso não são usados em publicidade nem enviados a plataformas de anúncios.'),
      P(medicao),
      P('§ 5º. Direitos do titular podem ser exercidos pelo e-mail rodrigo@rumosadv.com.br.'),
      H('Cláusula 9ª — Disposições finais'),
      P('§ 1º. A CONTRATADA assume obrigação de meio. Não há promessa de restabelecimento da conta nem de prazo de resposta da plataforma.'),
      P('§ 2º. As partes admitem a assinatura eletrônica deste contrato por plataforma que registre autoria e integridade, nos termos do art. 10, § 2º, da MP nº 2.200-2/2001.'),
      P('§ 3º. Fica eleito o foro da Comarca de Campinas/SP para as questões deste contrato.'),
      { k: 'sign', data: 'Campinas, ' + dataExtenso(d.hoje || new Date()) + '.', a: 'CONTRATANTE — ' + (pj ? nome + ' — CNPJ ' + doc : nome + ' — CPF ' + doc), a2: pj ? 'Representada por ' + clean(d.rep_nome) + ' — CPF ' + fmtDoc(d.rep_cpf) : '', b: 'CONTRATADA — Rodrigo Moura Silva Sociedade Individual de Advocacia', b2: 'Rodrigo Moura Silva — OAB/SP 188.004' }
    ];
  }

  async function gerar(d) {
    var falta = validar(d); if (falta.length) throw new Error('Preencha: ' + falta.join('; ') + '.');
    var pdf = await PDFLib.PDFDocument.create();
    var R = await pdf.embedFont(PDFLib.StandardFonts.TimesRoman), B = await pdf.embedFont(PDFLib.StandardFonts.TimesRomanBold);
    var W = 595.28, Hh = 841.89, ML = 76, MR = 70, MT = 74, MB = 70, SZ = 11.5, LEAD = 16.2, width = W - ML - MR;
    var ink = PDFLib.rgb(0.1, 0.1, 0.1), soft = PDFLib.rgb(0.4, 0.4, 0.4);
    var page, y; var newPage = function () { page = pdf.addPage([W, Hh]); y = Hh - MT; }; newPage();
    var room = function (h) { if (y - h < MB) newPage(); };
    // Fontes padrão do PDF só têm o alfabeto latino ocidental; o que não existir vira "?".
    var safe = function (s, font) { var out = ''; for (var i = 0; i < s.length; i++) { var ch = s[i]; try { font.widthOfTextAtSize(ch, 10); out += ch; } catch (e) { out += '?'; } } return out; };
    var words = function (t) { var out = [], bold = false; t.split('**').forEach(function (seg) { seg.split(/\s+/).filter(Boolean).forEach(function (w) { var f = bold ? B : R; out.push({ w: safe(w, f), f: f }); }); bold = !bold; }); return out; };
    function para(t, opt) { opt = opt || {}; var indent = opt.indent || 0, ws = words(t), space = R.widthOfTextAtSize(' ', SZ), lines = [], cur = [], cw = 0, maxw = width - indent;
      ws.forEach(function (o) { o.wd = o.f.widthOfTextAtSize(o.w, SZ); if (cur.length && cw + space + o.wd > maxw) { lines.push({ ws: cur, cw: cw }); cur = []; cw = 0; } cw += (cur.length ? space : 0) + o.wd; cur.push(o); });
      if (cur.length) lines.push({ ws: cur, cw: cw, last: true });
      lines.forEach(function (ln, i) { room(LEAD); if (i === 0 && opt.bullet) page.drawText('•', { x: ML + 4, y: y, size: SZ, font: R, color: ink });
        var gap = space; if (!opt.left && !ln.last && ln.ws.length > 1) gap = Math.min(space + (maxw - ln.cw) / (ln.ws.length - 1), space * 3.2);
        var x = ML + indent; ln.ws.forEach(function (o) { page.drawText(o.w, { x: x, y: y, size: SZ, font: o.f, color: ink }); x += o.wd + gap; }); y -= LEAD; });
      y -= opt.after == null ? 6 : opt.after; }
    function center(t, font, size, color) { t = safe(t, font); room(size + 6); page.drawText(t, { x: ML + (width - font.widthOfTextAtSize(t, size)) / 2, y: y, size: size, font: font, color: color || ink }); y -= size + 6; }
    blocos(d).forEach(function (b) {
      if (b.k === 'title') center(b.t, B, 13.5);
      else if (b.k === 'sub') { center(b.t, R, 11.5, soft); y -= 10; }
      else if (b.k === 'h') { room(LEAD * 3.2); y -= 8; page.drawText(safe(b.t, B), { x: ML, y: y, size: 12, font: B, color: ink }); y -= LEAD + 4; }
      else if (b.k === 'li') para(b.t, { indent: 18, bullet: true, after: 3 });
      else if (b.k === 'p') para(b.t);
      else if (b.k === 'sign') { room(190); y -= 10; para(b.data, { after: 34 });
        [[b.a, b.a2], [b.b, b.b2]].forEach(function (s) { page.drawLine({ start: { x: ML, y: y + 12 }, end: { x: ML + 290, y: y + 12 }, thickness: 0.6, color: ink }); para(s[0], { after: 0, left: true }); if (s[1]) para(s[1], { after: 0, left: true }); y -= 38; }); }
    });
    var pages = pdf.getPages(), foot = 'Contrato de prestação de serviços advocatícios — etapa administrativa · Proposta nº ' + safe(clean(d.proposta_numero), R);
    pages.forEach(function (p, i) { var t = foot + ' · página ' + (i + 1) + ' de ' + pages.length; p.drawText(t, { x: ML, y: 38, size: 8.5, font: R, color: soft }); });
    pdf.setTitle('Contrato — etapa administrativa — ' + clean(d.nome)); pdf.setAuthor('Rumos Advocacia'); pdf.setLanguage('pt-BR');
    return pdf.save();
  }
  return { gerar: gerar, validar: validar, blocos: blocos, fmtDoc: fmtDoc, fmtFone: fmtFone };
});
