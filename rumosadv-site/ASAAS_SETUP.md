# Integração Asaas — Análise de Viabilidade Rumos

## Fluxo

1. Cliente registra o aceite em `/marcas/aceite/`.
2. O front chama `POST /api/checkout` com o `aceite_id`.
3. A Function cria um Checkout Asaas avulso de R$ 390 com PIX e cartão.
4. O `aceite_id` é enviado como `externalReference`.
5. O Asaas redireciona o pagador para `/marcas/aceite/pagamento/`.
6. O webhook `POST /api/webhooks/asaas` atualiza o D1 com `CHECKOUT_PAID`, `CHECKOUT_CANCELED` ou `CHECKOUT_EXPIRED`.

## D1

Execute `migrations/0002_asaas_checkout.sql` no banco `rumos-aceites`.

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

O endpoint valida o header `asaas-access-token` e grava o ID de cada evento em `asaas_webhook_events`, garantindo idempotência por `INSERT OR IGNORE`.

## Produção

Depois do teste completo no Sandbox:

1. usar a API key de produção;
2. definir `ASAAS_ENV=production`;
3. definir `PUBLIC_BASE_URL=https://rumosadv.com.br`;
4. cadastrar o webhook de produção em `https://rumosadv.com.br/api/webhooks/asaas`;
5. manter um token de webhook próprio para produção.

A URL de callback não deve ser usada como prova de pagamento: o status `pago` é atualizado somente pelo webhook `CHECKOUT_PAID`.
