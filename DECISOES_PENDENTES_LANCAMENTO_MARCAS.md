# Decisões pendentes para lançamento — Rumos Marcas

Atualizado em 4 de setembro de 2026. Este documento não substitui revisão jurídica do caso concreto. Ele registra somente as escolhas que o escritório precisa fazer antes de liberar produção, pagamento real e anúncios.

## Situação geral

**Prosseguir com condições.** O desenvolvimento e os testes controlados em Preview podem continuar. Produção e mídia paga permanecem bloqueadas até a conclusão dos itens abaixo.

## 1. Cancelamento e reembolso

Escolher uma política e incorporá-la ao termo de contratação, com canal de solicitação, momento de início, efeito de briefing incompleto e envio de cópia do aceite.

- **Opção A — recomendada para o lançamento:** reembolso integral quando solicitado em até 7 dias, mesmo que a análise já tenha começado. Reduz atrito e risco de disputa, mas admite algum oportunismo.
- **Opção B:** reembolso proporcional às etapas efetivamente executadas e documentadas. Reduz o custo comercial de cancelamentos, mas aumenta a complexidade e o risco interpretativo.

Decisão do escritório: **pendente**.

## 2. Identificação profissional

Confirmar e fornecer, exatamente como registrados:

- nome registral da sociedade de advocacia;
- CNPJ;
- número de registro da sociedade na OAB;
- papel da expressão “Rumos Marcas & Negócios”: marca visual secundária ou identificação principal.

Até essa confirmação, o nome registral deve ser tratado como identificação principal e a expressão de marca não deve substituir os dados profissionais obrigatórios.

Decisão do escritório: **pendente**.

## 3. Publicidade e pós-venda

Aprovar ou rejeitar em bloco os seguintes ajustes antes de anunciar:

1. retirar da página pública “Sem custo na primeira conversa”;
2. trocar “Por que isso é urgente” por “Por que avaliar antes de protocolar”;
3. substituir a afirmação não comprovada “A maior parte dos pedidos...” por texto objetivo;
4. qualificar afirmações sobre prioridade do depósito para não ignorar exceções legais;
5. manter preço e eventual crédito apenas no aceite privado ou em proposta individualizada, nunca como chamariz do anúncio;
6. iniciar o pós-venda com uma pergunta de permissão e enviar valores somente após resposta afirmativa:

> Se desejar, posso preparar uma proposta individualizada para o depósito e o acompanhamento do pedido. Deseja recebê-la?

Decisão do escritório: **pendente**.

Referência oficial: Provimento CFOAB 205/2021, especialmente a exigência de publicidade informativa, discreta e sóbria e a vedação de honorários, gratuidade ou descontos como forma de captação: https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021

## 4. Privacidade, fornecedores e retenção

A política precisa refletir o fluxo real: nome, CPF/CNPJ, e-mail, telefone, IP, navegador, marca/logotipo, briefing, aceite e hash do termo, pagamento, relatório e eventos administrativos. Também precisa identificar o uso de Cloudflare, Asaas, Tally, WhatsApp/Meta, Google e Meta conforme a função efetivamente exercida por cada fornecedor.

Decisões necessárias:

- prazo de retenção para lead que não contrata;
- prazo de retenção para logs de segurança e antiabuso;
- regras próprias para contrato, pagamento, relatório e evidências profissionais/fiscais;
- procedimento de exclusão, bloqueio e preservação quando houver obrigação legal ou exercício de direitos;
- aprovação da conferência dos contratos, suboperadores, local de tratamento e transferências internacionais dos fornecedores;
- autorização para exibir aviso curto antes do Tally e bloquear cookies não essenciais até a escolha do visitante.

Proposta provisória para discussão, não aprovada: 90 dias para leads sem contratação e 12 meses para logs estritamente de segurança; contratos, comprovantes e documentos profissionais seguem prazo jurídico/fiscal específico a ser definido pelo escritório.

Referências oficiais:

- LGPD — finalidade, necessidade, transparência, segurança, bases legais, direitos e conservação: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Resolução CD/ANPD 19/2024 — mecanismos e transparência em transferências internacionais: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024

Decisão do escritório: **pendente**.

## 5. Assistente virtual

Autorizar esta identificação no início da conversa automatizada:

> Você está falando com a assistente virtual da Rumos. Ela coleta informações iniciais; orientações e decisões jurídicas são prestadas ou revisadas pelo advogado responsável.

Decisão do escritório: **pendente**.

## 6. Calendário do prazo de 1 dia útil

Os feriados oficiais de 2026 — nacionais, estaduais e municipais de Campinas — já foram incluídos no ambiente de Preview conforme o Decreto Municipal nº 24.240/2026. Falta decidir se pontos facultativos e recessos internos também deixarão de contar no prazo. O sistema não representa meio expediente: 24 e 31 de dezembro, por exemplo, devem ser tratados como dia inteiro contado ou excluído.

Referência oficial: https://portal-adm.campinas.sp.gov.br/sites/default/files/publicacoes-dom/dom/1796221351420113514217962215.pdf

Decisão do escritório: **pendente**.

## 7. Oferta da etapa de registro

Fixar antes do lançamento:

- honorários da etapa de depósito e acompanhamento;
- o que está incluído e excluído;
- tratamento de classes adicionais;
- responsabilidade pelas retribuições do INPI;
- validade e forma de aplicação do crédito da análise, se mantido;
- resposta-padrão para marca nominativa, mista e figurativa, prazo do INPI e ausência de garantia de concessão.

Decisão do escritório: **pendente**.

## 8. Comprovações técnicas ainda necessárias

- Turnstile configurado e validado no ambiente Preview;
- UAT Sandbox de aceite, checkout, pagamento, webhook e D1;
- repetição e inversão de eventos de pagamento sem regressão de estado;
- caso nominativo, misto e de apresentação indefinida percorridos no painel;
- PDF simulado conferido e comprovante de entrega arquivado;
- eventos de marketing e conversão validados sem duplicidade;
- destinos, telefones, localização, horários e orçamento revisados antes de ativar cada campanha.

## Aprovação final

Produção só pode ser liberada depois de:

1. decisões 1 a 7 registradas;
2. comprovações técnicas concluídas;
3. atualização do termo, política, página, mensagens e configuração;
4. teste controlado de produção expressamente autorizado;
5. registro da aprovação no `CHECKLIST_LANCAMENTO_MARCAS.md`.
