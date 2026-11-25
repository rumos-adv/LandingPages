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
    need('plataforma', 'Plataforma'); need('conta_numero', d.servico === 'dinheiro_retido' ? 'Identificação da conta na plataforma' : d.servico === 'divida_ativa' ? 'Processo ou inscrições' : 'Número da conta afetada'); need('ocorrencia', 'Tipo de ocorrência'); need('data_fato', 'Data em que percebeu'); need('proposta_numero', 'Número da proposta');
    if (d.servico === 'dinheiro_retido') { if (!HON[d.opcao] || !HON[d.opcao][d.rito]) f.push('Rito e opção de honorários'); }
    if (d.servico === 'divida_ativa') { if (!HON_FA[d.opcao] || !HON_FA[d.opcao][d.rito]) f.push('Modalidade e opção de honorários'); }
    return f;
  }

  // Honorários iniciais do serviço "dinheiro retido". Devem coincidir com HONORARIOS_DR no servidor.
  var HON = { A: { jec: [1500, 'mil e quinhentos reais'], comum: [2500, 'dois mil e quinhentos reais'] }, B: { jec: [1000, 'mil reais'], comum: [2000, 'dois mil reais'] } };
  var brl = function (n) { return 'R$ ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',00'; };

  function qualificacao(d) {
    var pj = d.tipo === 'pj', nome = clean(d.nome).toUpperCase(), doc = fmtDoc(d.cpf_cnpj), fone = fmtFone(d.whatsapp);
    return pj
      ? '**CONTRATANTE:** ' + nome + ', CNPJ nº ' + doc + ', com sede em ' + clean(d.endereco) + ', e-mail ' + clean(d.email) + ', telefone ' + fone + ', neste ato representada por ' + clean(d.rep_nome) + ', ' + clean(d.rep_cargo) + ', CPF nº ' + fmtDoc(d.rep_cpf) + '.'
      : '**CONTRATANTE:** ' + nome + ', ' + clean(d.nacionalidade) + ', ' + clean(d.estado_civil) + ', ' + clean(d.profissao) + ', CPF nº ' + doc + ', residente e domiciliado(a) em ' + clean(d.endereco) + ', e-mail ' + clean(d.email) + ', telefone ' + fone + '.';
  }
  var CONTRATADA = '**CONTRATADA:** RODRIGO MOURA SILVA SOCIEDADE INDIVIDUAL DE ADVOCACIA (nome fantasia Rumos Advocacia), CNPJ nº 68.258.534/0001-56, registrada na OAB/SP em 24/04/2026, representada por seu sócio único e administrador, o advogado RODRIGO MOURA SILVA, OAB/SP nº 188.004, com endereço profissional no Condomínio Alphapark Tower, Campinas/SP, e-mail rodrigo@rumosadv.com.br.';

  // Contrato da medida judicial por saldo retido, repasse bloqueado ou conta suspensa em plataforma. Texto-base: 16/11/2026.
  function blocosDinheiroRetido(d) {
    var pj = d.tipo === 'pj', nome = clean(d.nome).toUpperCase(), doc = fmtDoc(d.cpf_cnpj), fone = fmtFone(d.whatsapp);
    var jec = d.rito === 'jec', B = d.opcao === 'B', hon = HON[d.opcao][d.rito];
    var P = function (t) { return { k: 'p', t: t }; }, H = function (t) { return { k: 'h', t: t }; }, L = function (t) { return { k: 'li', t: t }; };
    var retido = clean(d.valor_retido) ? ', com valores retidos de aproximadamente ' + clean(d.valor_retido) : '';
    var medicao = d.opoe_medicao
      ? '§ 4º. O(a) CONTRATANTE manifestou oposição ao envio de informações sobre esta contratação a plataformas de anúncios para fins de medição de publicidade. Nenhum envio dessa natureza será feito.'
      : '§ 4º. Se o(a) CONTRATANTE chegou ao escritório por anúncio, a CONTRATADA pode informar à plataforma de anúncios, apenas por meio do identificador técnico do clique, a ocorrência da contratação e o valor dos honorários, para medir o resultado de sua publicidade. Não são enviados nome, telefone, e-mail ou qualquer informação sobre o caso. O(a) CONTRATANTE pode se opor a esse envio a qualquer tempo, pelo canal oficial, sem qualquer efeito sobre este contrato.';
    var out = [
      { k: 'title', t: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS' }, { k: 'sub', t: 'Medida judicial — valores retidos ou conta suspensa em plataforma digital' },
      H('Qualificação das partes'), P(qualificacao(d)), P(CONTRATADA),
      P('As partes ajustam o presente contrato, regido pela Lei nº 8.906/1994 e pelo Código de Ética e Disciplina da OAB, conforme a Proposta nº ' + clean(d.proposta_numero) + ', que o integra.'),
      H('Cláusula 1ª — Objeto'),
      P('A CONTRATADA prestará serviços advocatícios para a defesa dos interesses do(a) CONTRATANTE em face de ' + clean(d.plataforma) + ', em razão de ' + clean(d.ocorrencia) + ' relativo(a) à conta identificada como ' + clean(d.conta_numero) + ', percebido(a) em ' + dataBR(d.data_fato) + retido + '.'),
      P('§ 1º. O serviço compreende:'),
      P('(i) análise jurídica do caso, dos avisos da plataforma, dos termos de uso aplicáveis e dos documentos fornecidos;'),
      P('(ii) notificação à plataforma, quando a CONTRATADA a considerar útil;'),
      P('(iii) propositura de ação judicial ' + (jec ? 'no Juizado Especial Cível' : 'pelo procedimento comum') + ', com pedido de tutela de urgência quando cabível, visando, conforme o caso, ao restabelecimento da conta, à liberação ou restituição dos valores retidos e à reparação dos prejuízos;'),
      P('(iv) acompanhamento do processo até a sentença de primeiro grau, incluídos audiências, manifestações e o recurso contra a sentença ou as contrarrazões ao recurso da parte contrária' + (jec ? ' (recurso inominado)' : ' (apelação)') + ';'),
      P('(v) cumprimento da decisão favorável, até a efetiva liberação ou pagamento dos valores; e'),
      P('(vi) informação ao(à) CONTRATANTE sobre cada ato relevante.'),
      P('§ 2º. Não estão compreendidos, salvo contratação escrita própria: recursos aos tribunais superiores; ações ou incidentes distintos; outras contas, plataformas ou fatos; questões criminais ou tributárias; perícias e pareceres técnicos.'),
      P('§ 3º. A definição da estratégia processual, inclusive do rito e dos pedidos, cabe à CONTRATADA, ouvido(a) o(a) CONTRATANTE. Se a análise do item (i) indicar que o rito mais adequado é diverso do previsto nesta cláusula, as partes ajustarão por escrito a alteração e os honorários correspondentes antes do ajuizamento.'),
      P('§ 4º. A petição inicial será enviada ao(à) CONTRATANTE para conferência dos fatos antes do protocolo. A procuração é outorgada em instrumento próprio.'),
      H('Cláusula 2ª — Honorários e pagamento')
    ];
    out.push(P('Pelos serviços da Cláusula 1ª são devidos honorários iniciais de ' + brl(hon[0]) + ' (' + hon[1] + '), pagos na contratação' + (B ? ', e honorários de êxito, na forma do § 2º.' : '. Não há honorários de êxito.')));
    out.push(P('§ 1º. Pagamento por Pix ou cartão de crédito, à vista ou em até 3 parcelas no cartão, pela página de pagamento do Asaas (instituição de pagamento autorizada pelo Banco Central), liberada ao(à) CONTRATANTE após a assinatura deste contrato. O comprovante do Asaas vale como recibo; a CONTRATADA emite recibo próprio quando solicitado. Os pagamentos são recebidos em conta de titularidade de Rodrigo Moura Silva, sócio titular da CONTRATADA, que a CONTRATADA indica para esse fim; o pagamento feito nessa conta quita os honorários perante a CONTRATADA. Se a página de pagamento estiver indisponível, o pagamento pode ser feito por Pix à chave rodrigo@rumosadv.com.br, da mesma titularidade, mediante confirmação prévia pelo canal oficial.'));
    if (B) {
      out.push(P('§ 2º. **Honorários de êxito.** São devidos 10% (dez por cento) sobre o proveito econômico total obtido pelo(a) CONTRATANTE, assim entendidos os valores liberados, restituídos ou pagos em razão da atuação da CONTRATADA, inclusive indenizações, lucros cessantes, multas e juros, por decisão judicial, acordo ou cumprimento espontâneo pela parte contrária após a notificação ou o ajuizamento. Os honorários de êxito são exigíveis à medida que os valores forem recebidos ou liberados, em até 5 dias úteis de cada recebimento.'));
      out.push(P('§ 3º. Não havendo proveito econômico, nada é devido a título de êxito.'));
    } else {
      out.push(P('§ 2º. Os honorários desta cláusula remuneram integralmente os serviços da Cláusula 1ª, qualquer que seja o valor obtido pelo(a) CONTRATANTE.'));
      out.push(P('§ 3º. Serviços não compreendidos na Cláusula 1ª dependem de proposta e contrato próprios.'));
    }
    out = out.concat([
      P('§ 4º. Os honorários de sucumbência eventualmente fixados pelo juízo pertencem à CONTRATADA, nos termos do art. 23 da Lei nº 8.906/1994, e não se confundem com os honorários deste contrato.'),
      P('§ 5º. A assinatura deste contrato formaliza a contratação. A confirmação do pagamento dos honorários iniciais marca o início dos trabalhos, que compreendem desde logo o atendimento, o estudo do caso e a análise dos documentos. Os honorários iniciais não dependem do resultado e, iniciados os trabalhos, não são restituídos, ressalvada a Cláusula 6ª, § 2º.'),
      H('Cláusula 3ª — Custas, despesas e riscos do processo'),
      P('§ 1º. Custas, taxas, preparo de recursos, despesas com citação, atas notariais e demais despesas do processo correm por conta do(a) CONTRATANTE e só são realizadas com sua autorização prévia.'),
      P(jec ? '§ 2º. No Juizado Especial Cível não há custas em primeiro grau nem condenação em honorários à parte contrária, salvo litigância de má-fé; a interposição de recurso exige o recolhimento do preparo.'
            : '§ 2º. No procedimento comum, a parte vencida responde pelas custas e por honorários ao advogado da parte contrária, fixados pelo juízo. O(a) CONTRATANTE declara ter sido informado(a) desse risco.'),
      P('§ 3º. A CONTRATADA assume obrigação de meio. Não há promessa de resultado, de concessão de tutela de urgência, de valor de indenização nem de prazo de tramitação.'),
      H('Cláusula 4ª — Obrigações da CONTRATADA'),
      L('Atuar com zelo e técnica, sob responsabilidade pessoal do advogado em todos os atos jurídicos.'), L('Manter sigilo profissional.'), L('Informar os atos relevantes do processo e as propostas de acordo recebidas.'),
      L('Submeter ao(à) CONTRATANTE, para decisão, qualquer proposta de acordo.'),
      L('**Nunca** solicitar senha, código de verificação ou acesso à conta do(a) CONTRATANTE na plataforma.'),
      H('Cláusula 5ª — Obrigações do(a) CONTRATANTE'),
      L('Informar os fatos com verdade, inclusive os desfavoráveis, como contestações de compradores, reclamações, infrações apontadas pela plataforma ou uso da conta por terceiros.'),
      L('Fornecer os documentos solicitados e preservar os originais de avisos, e-mails, extratos e mensagens; não editar capturas de tela.'),
      L('Comunicar imediatamente: liberação de valores, restabelecimento da conta, nova comunicação ou proposta da plataforma, contratação de terceiro para o mesmo fim ou mudança de contato.'),
      L('Comparecer às audiências designadas, quando sua presença for exigida.'),
      L('Pagar os honorários e as despesas autorizadas.'),
      P('Parágrafo único. Alertas e resumos automáticos de sites de consulta processual podem conter erros. A informação válida sobre o processo é a prestada pela CONTRATADA.'),
      H('Cláusula 6ª — Encerramento'),
      P('§ 1º. O contrato se encerra com a conclusão dos serviços da Cláusula 1ª ou com a solução do caso por acordo ou cumprimento espontâneo.'),
      P('§ 2º. Qualquer parte pode rescindir o contrato por escrito. Na rescisão por culpa da CONTRATADA, é restituída a parcela dos honorários iniciais correspondente às atividades não concluídas com proveito.'),
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
      P('§ 1º. As partes admitem a assinatura eletrônica deste contrato por plataforma que registre autoria e integridade, nos termos do art. 10, § 2º, da MP nº 2.200-2/2001.'),
      P('§ 2º. Fica eleito o foro da Comarca de Campinas/SP para as questões deste contrato.'),
      { k: 'sign', data: 'Campinas, ' + dataExtenso(d.hoje || new Date()) + '.', a: 'CONTRATANTE — ' + (pj ? nome + ' — CNPJ ' + doc : nome + ' — CPF ' + doc), a2: pj ? 'Representada por ' + clean(d.rep_nome) + ' — CPF ' + fmtDoc(d.rep_cpf) : '', b: 'CONTRATADA — Rodrigo Moura Silva Sociedade Individual de Advocacia', b2: 'Rodrigo Moura Silva — OAB/SP 188.004' }
    ]);
    return out;
  }

  // Honorários do serviço "dívida ativa" (rito = modalidade). Devem coincidir com HONORARIOS_FA no servidor.
  var HON_FA = { A: { defesa: [3000, 'três mil reais'], transacao: [2000, 'dois mil reais'] }, B: { defesa: [2500, 'dois mil e quinhentos reais'], transacao: [1200, 'mil e duzentos reais'] } };

  // Contrato de dívida ativa da União: defesa em execução fiscal ou transação com a PGFN. Texto-base: 19/11/2026.
  function blocosDividaAtiva(d) {
    var pj = d.tipo === 'pj', nome = clean(d.nome).toUpperCase(), doc = fmtDoc(d.cpf_cnpj), fone = fmtFone(d.whatsapp);
    var defesa = d.rito === 'defesa', B = d.opcao === 'B', hon = HON_FA[d.opcao][d.rito];
    var P = function (t) { return { k: 'p', t: t }; }, H = function (t) { return { k: 'h', t: t }; }, L = function (t) { return { k: 'li', t: t }; };
    var valor = clean(d.valor_retido) ? ', com valor aproximado de ' + clean(d.valor_retido) : '';
    var medicao = d.opoe_medicao
      ? '§ 4º. O(a) CONTRATANTE manifestou oposição ao envio de informações sobre esta contratação a plataformas de anúncios para fins de medição de publicidade. Nenhum envio dessa natureza será feito.'
      : '§ 4º. Se o(a) CONTRATANTE chegou ao escritório por anúncio, a CONTRATADA pode informar à plataforma de anúncios, apenas por meio do identificador técnico do clique, a ocorrência da contratação e o valor dos honorários, para medir o resultado de sua publicidade. Não são enviados nome, telefone, e-mail ou qualquer informação sobre o caso. O(a) CONTRATANTE pode se opor a esse envio a qualquer tempo, pelo canal oficial, sem qualquer efeito sobre este contrato.';
    var out = [
      { k: 'title', t: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS' }, { k: 'sub', t: defesa ? 'Defesa em execução fiscal — dívida ativa da União' : 'Transação tributária com a PGFN — dívida ativa da União' },
      H('Qualificação das partes'), P(qualificacao(d)), P(CONTRATADA),
      P('As partes ajustam o presente contrato, regido pela Lei nº 8.906/1994 e pelo Código de Ética e Disciplina da OAB, conforme a Proposta nº ' + clean(d.proposta_numero) + ', que o integra.'),
      H('Cláusula 1ª — Objeto')
    ];
    if (defesa) {
      out = out.concat([
        P('A CONTRATADA prestará serviços advocatícios para a defesa do(a) CONTRATANTE em ' + clean(d.ocorrencia) + ', relativa a ' + clean(d.conta_numero) + ', movida por ' + clean(d.plataforma) + ', de que teve ciência em ' + dataBR(d.data_fato) + valor + '.'),
        P('§ 1º. O serviço compreende:'),
        P('(i) análise do processo, das certidões de dívida ativa e dos documentos fornecidos;'),
        P('(ii) apresentação da defesa cabível em primeiro grau — exceção de pré-executividade ou, havendo garantia do juízo, embargos à execução —, conforme avaliação técnica da CONTRATADA;'),
        P('(iii) pedidos de liberação de valores ou bens bloqueados, quando cabíveis;'),
        P('(iv) acompanhamento até a decisão de primeiro grau sobre a defesa apresentada; e'),
        P('(v) informação ao(à) CONTRATANTE sobre cada ato relevante.'),
        P('§ 2º. Não estão compreendidos, salvo contratação escrita própria: recursos a qualquer instância; ações autônomas (anulatória, mandado de segurança e outras); transação, parcelamento ou negociação com a Fazenda; outros processos ou inscrições; questões criminais; perícias e pareceres contábeis.'),
        P('§ 3º. A escolha da medida e a oportunidade de oferecer garantia cabem à CONTRATADA, ouvido(a) o(a) CONTRATANTE, que decide sobre o oferecimento de bens ou valores em garantia.'),
        P('§ 4º. A procuração é outorgada em instrumento próprio. Prazos processuais dependem do envio tempestivo dos documentos pedidos pela CONTRATADA.')
      ]);
    } else {
      out = out.concat([
        P('A CONTRATADA prestará serviços advocatícios ao(à) CONTRATANTE para a regularização de débitos inscritos em dívida ativa da União (' + clean(d.conta_numero) + '), perante a Procuradoria-Geral da Fazenda Nacional, em razão de ' + clean(d.ocorrencia) + ', com ciência em ' + dataBR(d.data_fato) + valor + '.'),
        P('§ 1º. O serviço compreende:'),
        P('(i) levantamento das inscrições, da situação de cada débito e da capacidade de pagamento atribuída pela PGFN;'),
        P('(ii) comparação, por escrito, das modalidades de transação por adesão e de parcelamento disponíveis, com indicação da mais adequada;'),
        P('(iii) pedido de revisão da capacidade de pagamento, quando cabível;'),
        P('(iv) adesão à modalidade escolhida pelo(a) CONTRATANTE no portal Regularize, por procuração ou com o acompanhamento do(a) CONTRATANTE; e'),
        P('(v) orientação sobre as obrigações do acordo nos 3 (três) meses seguintes à adesão.'),
        P('§ 2º. Não estão compreendidos, salvo contratação escrita própria: transação individual com proposta própria; defesa em execução fiscal, ações judiciais e recursos; débitos estaduais ou municipais; planejamento tributário; serviços contábeis, inclusive escrituração e emissão de guias.'),
        P('§ 3º. A decisão de aderir e a escolha da modalidade cabem ao(à) CONTRATANTE, após a orientação da CONTRATADA. As condições de desconto e prazo são as definidas pela PGFN no edital vigente e não dependem da CONTRATADA.'),
        P('§ 4º. O(a) CONTRATANTE fornecerá os acessos e documentos necessários (procuração eletrônica no e-CAC/Regularize ou acompanhamento da adesão). A CONTRATADA não solicita nem guarda senhas ou certificado digital.')
      ]);
    }
    out.push(H('Cláusula 2ª — Honorários e pagamento'));
    out.push(P('Pelos serviços da Cláusula 1ª são devidos honorários iniciais de ' + brl(hon[0]) + ' (' + hon[1] + '), pagos na contratação' + (B ? ', e honorários de êxito, na forma do § 2º.' : '. Não há honorários de êxito.')));
    out.push(P('§ 1º. Pagamento por Pix ou cartão de crédito, à vista ou em até 3 parcelas no cartão, pela página de pagamento do Asaas (instituição de pagamento autorizada pelo Banco Central), liberada ao(à) CONTRATANTE após a assinatura deste contrato. O comprovante do Asaas vale como recibo; a CONTRATADA emite recibo próprio quando solicitado. Os pagamentos são recebidos em conta de titularidade de Rodrigo Moura Silva, sócio titular da CONTRATADA, que a CONTRATADA indica para esse fim; o pagamento feito nessa conta quita os honorários perante a CONTRATADA. Se a página de pagamento estiver indisponível, o pagamento pode ser feito por Pix à chave rodrigo@rumosadv.com.br, da mesma titularidade, mediante confirmação prévia pelo canal oficial.'));
    if (B && defesa) {
      out.push(P('§ 2º. **Honorários de êxito.** São devidos 10% (dez por cento) sobre o valor cuja cobrança for afastada em relação ao(à) CONTRATANTE em razão da atuação da CONTRATADA — por extinção ou redução da execução, exclusão do(a) CONTRATANTE do polo passivo ou cancelamento de inscrições —, apurado pelo valor atualizado na data da decisão. São exigíveis em até 30 dias da decisão favorável de primeiro grau, independentemente de recurso da Fazenda, e restituídos na proporção do que for revertido em instância superior.'));
      out.push(P('§ 3º. Valores apenas liberados de bloqueio, sem redução da dívida, não geram honorários de êxito.'));
    } else if (B) {
      out.push(P('§ 2º. **Honorários de êxito.** São devidos 10% (dez por cento) sobre o desconto obtido, assim entendida a diferença entre o valor consolidado das inscrições antes da adesão e o valor total do acordo, conforme o demonstrativo do Regularize. Podem ser pagos em até 6 (seis) parcelas mensais, a primeira em até 10 dias da adesão.'));
      out.push(P('§ 3º. Não havendo adesão por decisão do(a) CONTRATANTE, nada é devido a título de êxito. Se o acordo for rescindido pela PGFN, as parcelas de êxito ainda não vencidas deixam de ser devidas; as já vencidas permanecem devidas.'));
    } else {
      out.push(P('§ 2º. Os honorários desta cláusula remuneram integralmente os serviços da Cláusula 1ª, qualquer que seja o resultado obtido.'));
      out.push(P('§ 3º. Serviços não compreendidos na Cláusula 1ª dependem de proposta e contrato próprios.'));
    }
    out = out.concat([
      P('§ 4º. Os honorários de sucumbência eventualmente fixados pelo juízo pertencem à CONTRATADA, nos termos do art. 23 da Lei nº 8.906/1994, e não se confundem com os honorários deste contrato.'),
      P('§ 5º. A assinatura deste contrato formaliza a contratação. A confirmação do pagamento dos honorários iniciais marca o início dos trabalhos, que compreendem desde logo o atendimento, o estudo do caso e a análise dos documentos. Os honorários iniciais não dependem do resultado e, iniciados os trabalhos, não são restituídos, ressalvada a Cláusula 6ª, § 2º.'),
      H('Cláusula 3ª — Despesas e riscos'),
      P('§ 1º. Custas, despesas processuais, emolumentos, garantias, parcelas do acordo e tributos correm por conta do(a) CONTRATANTE. Despesas que dependam da CONTRATADA só são realizadas com autorização prévia.'),
      P(defesa ? '§ 2º. A rejeição da defesa pode implicar a continuidade da cobrança, com encargos legais. O(a) CONTRATANTE declara ter sido informado(a) desse risco.' : '§ 2º. O descumprimento do acordo pelo(a) CONTRATANTE pode levar à sua rescisão e à perda dos descontos, conforme o edital. O(a) CONTRATANTE declara ter sido informado(a) desse risco.'),
      P('§ 3º. A CONTRATADA assume obrigação de meio. Não há promessa de resultado, de desconto, de liberação de valores nem de prazo de resposta da Fazenda ou do Judiciário.'),
      H('Cláusula 4ª — Obrigações da CONTRATADA'),
      L('Atuar com zelo e técnica, sob responsabilidade pessoal do advogado em todos os atos jurídicos.'), L('Manter sigilo profissional.'), L('Informar os atos relevantes e as decisões que dependam do(a) CONTRATANTE.'),
      L('**Nunca** solicitar senha, código de acesso ou certificado digital do(a) CONTRATANTE.'),
      H('Cláusula 5ª — Obrigações do(a) CONTRATANTE'),
      L('Informar os fatos com verdade e entregar os documentos pedidos nos prazos indicados.'),
      L('Comunicar imediatamente citações, intimações, bloqueios, novas inscrições ou contato da Fazenda.'),
      L('Manter o(a) contador(a) informado(a) e pagar em dia as parcelas e tributos correntes.'),
      L('Pagar os honorários e as despesas autorizadas.'),
      H('Cláusula 6ª — Encerramento'),
      P('§ 1º. O contrato se encerra com a conclusão dos serviços da Cláusula 1ª.'),
      P('§ 2º. Qualquer parte pode rescindir o contrato por escrito. Na rescisão por culpa da CONTRATADA, é restituída a parcela dos honorários iniciais correspondente às atividades não concluídas com proveito.'),
      H('Cláusula 7ª — Canal oficial e prevenção a fraudes'),
      P('§ 1º. O canal oficial escolhido pelo(a) CONTRATANTE é o WhatsApp nº ' + fone + ', com o e-mail ' + clean(d.email) + ' como alternativa. Os remetentes oficiais da CONTRATADA são o WhatsApp (19) 98911-9770 e o e-mail rodrigo@rumosadv.com.br.'),
      P('§ 2º. Guias e boletos de tributos são emitidos apenas nos sistemas oficiais (Regularize, e-CAC). A CONTRATADA não envia cobrança de tributos nem pede depósito para "liberar" acordo. Em caso de dúvida, o(a) CONTRATANTE deve confirmar pelo WhatsApp oficial antes de pagar.'),
      P('§ 3º. Rotinas de atendimento e acompanhamento podem ser executadas por sistemas automatizados do escritório, identificados como tais, sob supervisão do advogado.'),
      H('Cláusula 8ª — Confidencialidade, dados pessoais e medição de publicidade'),
      P('§ 1º. A CONTRATADA trata os dados pessoais do(a) CONTRATANTE para executar este contrato, nos termos da Lei nº 13.709/2018, pelo tempo necessário a essa finalidade e aos prazos legais.'),
      P('§ 2º. O tratamento pode envolver fornecedores de hospedagem, mensagens, assinatura eletrônica, pagamento e ferramentas de inteligência artificial usadas para organizar e resumir informações, sempre sob revisão do advogado, conforme o aviso de privacidade em rumosadv.com.br/politica-de-privacidade.'),
      P('§ 3º. Documentos e informações fiscais do caso não são usados em publicidade nem enviados a plataformas de anúncios.'),
      P(medicao),
      P('§ 5º. Direitos do titular podem ser exercidos pelo e-mail rodrigo@rumosadv.com.br.'),
      H('Cláusula 9ª — Disposições finais'),
      P('§ 1º. As partes admitem a assinatura eletrônica deste contrato por plataforma que registre autoria e integridade, nos termos do art. 10, § 2º, da MP nº 2.200-2/2001.'),
      P('§ 2º. Fica eleito o foro da Comarca de Campinas/SP para as questões deste contrato.'),
      { k: 'sign', data: 'Campinas, ' + dataExtenso(d.hoje || new Date()) + '.', a: 'CONTRATANTE — ' + (pj ? nome + ' — CNPJ ' + doc : nome + ' — CPF ' + doc), a2: pj ? 'Representada por ' + clean(d.rep_nome) + ' — CPF ' + fmtDoc(d.rep_cpf) : '', b: 'CONTRATADA — Rodrigo Moura Silva Sociedade Individual de Advocacia', b2: 'Rodrigo Moura Silva — OAB/SP 188.004' }
    ]);
    return out;
  }

  function blocos(d) {
    if (d.servico === 'divida_ativa') return blocosDividaAtiva(d);
    if (d.servico === 'dinheiro_retido') return blocosDinheiroRetido(d);
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
    var pages = pdf.getPages(), foot = 'Contrato de prestação de serviços advocatícios — ' + (d.servico === 'dinheiro_retido' ? 'medida judicial' : d.servico === 'divida_ativa' ? (d.rito === 'defesa' ? 'defesa em execução fiscal' : 'transação com a PGFN') : 'etapa administrativa') + ' · Proposta nº ' + safe(clean(d.proposta_numero), R);
    pages.forEach(function (p, i) { var t = foot + ' · página ' + (i + 1) + ' de ' + pages.length; p.drawText(t, { x: ML, y: 38, size: 8.5, font: R, color: soft }); });
    pdf.setTitle('Contrato — ' + (d.servico === 'dinheiro_retido' ? 'medida judicial' : d.servico === 'divida_ativa' ? (d.rito === 'defesa' ? 'defesa em execução fiscal' : 'transação com a PGFN') : 'etapa administrativa') + ' — ' + clean(d.nome)); pdf.setAuthor('Rumos Advocacia'); pdf.setLanguage('pt-BR');
    return pdf.save();
  }
  return { gerar: gerar, validar: validar, blocos: blocos, fmtDoc: fmtDoc, fmtFone: fmtFone, HON: HON, HON_FA: HON_FA };
});
