# Integração Asaas — Análise de Viabilidade Rumos

## Fluxo normal: aceite → checkout → confirmação

1. Cliente registra o aceite em `/marcas/aceite/`.
2. O front chama `POST /api/checkout` com o `aceite_id`.
3. Antes de chamar o Asaas, a Function grava no aceite um **claim** temporário no formato `creating:<data-hora>:<tentativa>`. Esse bloqueio impede que dois cliques simultâneos criem dois checkouts.
4. A Function cria um Checkout Asaas avulso de R$ 390 com PIX e cartão.
5. Cada tentativa recebe uma referência própria no formato `<aceite_id>:<tentativa_id>`, enviada ao Asaas como `externalReference`. Assim, um evento atrasado de uma tentativa antiga não assume a tentativa nova.
6. Quando a criação é confirmada, o identificador e a URL do checkout substituem o claim no D1 e o status passa a `AWAITING_PAYMENT`.
7. O Asaas pode redirecionar o pagador para `/marcas/aceite/pagamento/`, mas esse callback serve apenas para navegação e mensagem ao cliente.
8. Somente o webhook autenticado `POST /api/webhooks/asaas` confirma no D1 os eventos `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e `CHECKOUT_EXPIRED`.

## Retomada e reconciliação

- Se já existir um checkout ativo, uma nova solicitação reutiliza o mesmo identificador e a mesma URL.
- Se o checkout estiver `CANCELED` ou `EXPIRED`, uma nova solicitação abre outra tentativa, com novo claim e novo `externalReference`.
- Se o aceite já estiver `PAID`, o sistema não cria nem reutiliza outro checkout.
- Um claim recente significa que a criação ainda está em andamento ou aguardando reconciliação. Nesse período, o cliente deve aguardar em vez de repetir cliques.
- Em falha de rede ou resposta ambígua do Asaas, o claim é preservado: o checkout pode ter sido criado externamente mesmo sem resposta conclusiva à página. O webhook tenta reconciliá-lo pelo `externalReference` da tentativa.
- Um claim antigo somente pode ser retomado depois da janela de segurança configurada no código. Antes de qualquer retomada manual, conferir o Asaas e `asaas_webhook_events` para evitar cobrança duplicada.
- Se a API responder com `code: CHECKOUT_STATE_REQUIRES_REVIEW`, existe um estado local malformado ou sem propriedade segura. Não apagar nem substituir o identificador às cegas; seguir a contingência descrita em `ROTINA_INTERNA_MARCAS.md`.

## URL segura do checkout

A URL devolvida pelo Asaas só é usada quando pertence ao host oficial esperado para o ambiente. Se o link vier ausente, inválido ou de outro host, a Function monta uma URL de fallback oficial a partir do identificador do checkout:

- Sandbox: `https://sandbox.asaas.com/checkoutSession/show/<checkout_id>`;
- Produção: `https://asaas.com/checkoutSession/show/<checkout_id>`.

O fallback não confirma pagamento; apenas fornece um endereço oficial para abrir a sessão já criada.

## D1

Em banco novo, execute as migrations em ordem no `rumos-aceites`:

1. `migrations/0001_aceites.sql`;
2. `migrations/0002_asaas_checkout.sql`;
3. `migrations/0003_analise_v1.sql`;
4. `migrations/0004_asaas_checkout_history.sql`;
5. `migrations/0005_marca_operational_events.sql`;
6. `migrations/0006_marca_search_completion.sql`;
7. `migrations/0007_redact_legacy_webhook_payloads.sql`;
8. `migrations/0008_marca_report_delivery_integrity.sql`.

Em ambiente que já recebeu as três primeiras, aplique a `0004`, depois a `0005`, a `0006`, a `0007` e por fim a `0008`. A `0007` remove o corpo integral de eventos legados e preserva somente as colunas de correlação; a `0008` vincula cada entrega à versão e ao hash do relatório aprovado. Depois, confirme a existência das tabelas `asaas_checkout_attempts`, `asaas_webhook_events` e `marca_operational_events`, além das colunas de auditoria, conclusão da pesquisa e integridade da entrega, antes de testar o checkout e o painel. O código atual depende desse histórico; publicar o código sem aplicar as migrations causa falha do checkout, do webhook ou das ações operacionais do painel.

## Variáveis / Secrets do Cloudflare Pages

No projeto `rumosadv-git`, configurar inicialmente no ambiente Preview:

- `ASAAS_API_KEY` — Secret com a chave da conta Sandbox do Asaas.
- `ASAAS_ENV` — `sandbox`.
- `ASAAS_WEBHOOK_TOKEN` — Secret aleatório de 32 a 255 caracteres, diferente da API key.
- `PUBLIC_BASE_URL` — opcional no Preview. Em produção usar `https://rumosadv.com.br`.

Nunca expor `ASAAS_API_KEY` ou `ASAAS_WEBHOOK_TOKEN` no HTML/JS público.

## Webhook no Asaas Sandbox

URL:

`https://<preview>.rumosadv-git.pages.dev/api/webhooks/asaas`

Eventos:

- `CHECKOUT_CREATED`
- `CHECKOUT_PAID`
- `CHECKOUT_CANCELED`
- `CHECKOUT_EXPIRED`

Token de autenticação: o mesmo valor definido em `ASAAS_WEBHOOK_TOKEN`.

O endpoint valida o header `asaas-access-token` com comparação resistente a diferenças de tempo e limita o tamanho do corpo recebido.

O ID de cada evento é gravado em `asaas_webhook_events`. O registro do evento e a atualização do aceite são enviados ao D1 no mesmo lote transacional: se a atualização falhar, o registro do evento também deve ser desfeito, permitindo nova entrega pelo Asaas.

Regras de estado e idempotência:

- uma repetição idêntica do mesmo `event.id` é segura e não reaplica efeitos;
- o mesmo `event.id` com conteúdo conflitante exige investigação;
- `PAID` é terminal e não pode regredir para `CANCELED`, `EXPIRED` ou `AWAITING_PAYMENT` por evento atrasado;
- `CHECKOUT_CREATED` atrasado não reabre uma tentativa já cancelada ou expirada;
- eventos reconhecidos que não possam ser vinculados com segurança ao aceite respondem como não reconciliados, permanecem auditáveis e exigem verificação;
- eventos não utilizados pela integração podem ser registrados para auditoria sem alterar o aceite.

Os webhooks do Asaas devem ser tratados como entregues pelo menos uma vez e potencialmente fora de ordem. O callback do navegador e a tela de sucesso **não provam pagamento**. Para liberar a análise, exigir `payment_status = PAID` e `paid_at` preenchido no D1.

## Produção

Produção somente deve ser configurada depois de um teste controlado em Preview/Sandbox, cobrindo criação do checkout, pagamento de teste, recebimento do webhook, atualização de `payment_status`, preenchimento de `paid_at` e auditoria em `asaas_webhook_events`. Este documento não afirma que esse UAT já foi concluído.

Depois da aprovação expressa do teste controlado:

1. usar a API key de produção;
2. definir `ASAAS_ENV=production`;
3. definir `PUBLIC_BASE_URL=https://rumosadv.com.br`;
4. cadastrar o webhook de produção em `https://rumosadv.com.br/api/webhooks/asaas`;
5. manter um token de webhook próprio para produção.

Após configurar, repetir um teste controlado de produção com valor e caso previamente autorizados, antes de liberar anúncios e tráfego real. Nunca copiar para produção a chave, o token de webhook ou a URL do Sandbox.
