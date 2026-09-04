# Roteiro de pós-venda — Análise de viabilidade de marca

## Objetivo

Converter a análise em uma decisão consciente: protocolar, ajustar a estratégia ou interromper o projeto. A cadência abaixo é um repertório condicional, não uma sequência obrigatória de disparos.

## Regras

1. O **D0** é a data de entrega efetiva do PDF.
2. Interromper a cadência quando houver contratação, resposta em andamento, pedido expresso para não receber mensagens ou conclusão de que o depósito não é recomendável sem nova estratégia.
3. Não reenviar mensagem se já existir conversa ativa sobre o mesmo ponto.
4. Não usar urgência artificial. O vencimento do crédito é informação comercial verdadeira; não é prazo do INPI nem prazo de perda da marca.
5. Não afirmar que a marca está livre, disponível ou garantida.
6. Casos de risco elevado ou desaconselhados recebem convite para estratégia ou reformulação, não pressão para depósito.
7. Antes de enviar proposta, confirmar titular, apresentação, classes, especificação e escopo do acompanhamento.
8. Na V1, copiar e enviar cada mensagem manualmente. Não criar disparos automáticos sem definir a base legal, a transparência, o mecanismo de oposição e as regras aplicáveis ao canal.
9. D3 e mensagens posteriores somente devem ser usadas quando o acompanhamento for razoavelmente esperado no contexto do atendimento e o cliente não tiver recusado novos contatos.

## Cadência

### D0 — entrega

- Enviar PDF e resumo em linguagem clara.
- Explicar a faixa de conclusão e a recomendação.
- Se favorável ou favorável com ressalvas, oferecer a proposta do pedido.
- Se risco elevado ou desaconselhado, oferecer conversa breve para alternativas.
- Registrar `delivered_at`, `report_file` e `credit_expires_at` no painel.

### D3 — compreensão

Objetivo: confirmar recebimento e esclarecer, sem tentar fechar a contratação a qualquer custo.

> {{primeiro_nome}}, conseguiu examinar o relatório da marca {{marca}}? Se algum ponto da conclusão ou das ressalvas não ficou claro, posso esclarecer por aqui. {{proximo_passo_conforme_risco}}

### D7 — decisão

Objetivo: descobrir se o cliente pretende avançar, ajustar ou aguardar.

> {{primeiro_nome}}, retomo a análise da marca {{marca}} para saber se você deseja definir o próximo passo. Os R$ 390 permanecem disponíveis como crédito nos honorários do pedido até {{data_credito}}.

### D15 — proposta ou estratégia

Para favorável/favorável com ressalvas:

> {{primeiro_nome}}, a estratégia indicada para a marca {{marca}} continua disponível. Se desejar, envio a proposta discriminando honorários, taxas oficiais, classes e acompanhamento, com aplicação do crédito da análise.

Para risco elevado/desaconselhado:

> {{primeiro_nome}}, sobre a marca {{marca}}: antes de pensar em protocolo, vale decidirmos se ajustaremos o sinal, a apresentação ou o escopo de proteção. Posso organizar essas alternativas em uma conversa breve.

### D25 — aviso de crédito

Objetivo: informar o vencimento próximo, sem sugerir que a proteção ou disponibilidade está reservada.

> {{primeiro_nome}}, aviso apenas para organização: o crédito de R$ 390 referente à análise da marca {{marca}} está previsto para encerrar em {{data_credito}}. Se você quiser avaliar o pedido, posso enviar a proposta completa antes dessa data.

### D30 — encerrar ou nutrir

> {{primeiro_nome}}, encerro por ora o acompanhamento comercial da análise da marca {{marca}}, para não ser inconveniente. O relatório continua válido como retrato das bases consultadas na data de corte; uma decisão futura pode exigir atualização da pesquisa.

## Decisão conforme a conclusão

### Favorável

Chamada principal: proposta do pedido conforme estratégia recomendada. Não prometer concessão.

### Favorável com ressalvas

Chamada principal: proposta acompanhada de explicação da limitação, ajuste de especificação, apresentação ou classe. Confirmar que o cliente compreendeu as ressalvas.

### Risco elevado

Chamada principal: reunião breve para comparar alternativas. Só apresentar proposta de depósito se houver estratégia específica revisada pelo advogado.

### Desaconselhado

Chamada principal: reformulação do sinal, naming ou nova pesquisa. Não oferecer o depósito do sinal analisado como caminho padrão.

## Conteúdo mínimo da proposta separada

- marca, titular e apresentação;
- classes e especificações;
- quantidade de pedidos;
- honorários;
- retribuições oficiais do INPI, discriminadas dos honorários;
- o que está incluído no acompanhamento;
- o que será contratado à parte: oposição, exigência, recurso ou medida judicial, conforme o caso;
- aplicação e data de vencimento do crédito dos R$ 390;
- validade da proposta e forma de pagamento.

## Registro interno

Até que exista automação própria, registrar comprovantes na pasta `05_entrega` e não marcar conversão apenas porque a proposta foi enviada. `registration_converted_at` significa contratação efetiva do pedido.

## Salvaguardas éticas e de privacidade

- O marketing jurídico deve permanecer informativo, objetivo, verdadeiro, discreto e sóbrio, sem captação indevida, mercantilização ou promessa de resultado.
- A cadência individual deste roteiro decorre de uma relação já iniciada pelo cliente e deve permanecer estritamente ligada ao serviço adquirido e aos próximos passos dessa mesma análise.
- Evitar expressões como “marca livre”, “registro aprovado”, “sem risco”, “garantia”, “última chance” ou contagem regressiva promocional.
- Oferecer saída simples e respeitar imediatamente oposição, recusa ou pedido para não receber novas mensagens.
- Minimizar dados e não copiar para o histórico de follow-up documentos, tokens ou conteúdo sigiloso desnecessário.
- Antes de automatizar o envio pela API do WhatsApp, revisar os termos de aceite, a base legal e as regras vigentes de templates e janela de atendimento.

Referências oficiais consultadas:

- Provimento OAB nº 205/2021: https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021
- Código de Ética e Disciplina da OAB, arts. 39 e 40: https://www.oab.org.br/leisnormas/legislacao/resolucoes/02-2015
- Guia da ANPD sobre legítimo interesse: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse
