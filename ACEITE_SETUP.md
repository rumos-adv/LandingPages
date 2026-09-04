# Aceite online — Análise de Viabilidade de Marca

Implementação inicial de `/marcas/aceite/`.

## O que já está no código

- Página de contratação e termo versão 1.0.
- Termo canônico versionado no servidor, com hash SHA-256 fixado e validado a cada aceite.
- Pages Function `POST /api/aceites`.
- Persistência prevista em Cloudflare D1.
- Registro de data/hora, IP, user-agent, versão e hash do termo.
- Chave idempotente criada no navegador antes do envio: uma resposta perdida pode ser retomada sem criar outro aceite.
- Validação e limites de tamanho no navegador e no servidor.
- Início automático do checkout depois do aceite confirmado.
- Retomada do mesmo checkout sem reenviar dados pessoais; o estado local guarda somente identificador, etapa e horário, com expiração automática.
- Eventos GTM distintos para aceite novo, checkout novo e retomada, permitindo deduplicação.
- Proteção Cloudflare Turnstile no aceite novo, com renderização explícita e validação obrigatória no servidor.
- Endpoint `GET /api/turnstile/config`, sem cache, que expõe somente a sitekey pública e a ação `marcas_aceite`.

## Configuração necessária no Cloudflare antes de publicar em produção

1. Criar um banco D1 para os aceites (ex.: `rumos-aceites`).
2. Executar as migrations em ordem: `0001_aceites.sql`, `0002_asaas_checkout.sql`, `0003_analise_v1.sql`, `0004_asaas_checkout_history.sql`, `0005_marca_operational_events.sql`, `0006_marca_search_completion.sql`, `0007_redact_legacy_webhook_payloads.sql` e `0008_marca_report_delivery_integrity.sql`.
3. No projeto Cloudflare Pages `rumosadv-git`, adicionar um binding D1 com o nome **`ACEITES_DB`** apontando para o banco criado.
4. Configurar o Turnstile conforme a seção abaixo.
5. Fazer um deploy da branch/preview e testar o formulário antes do merge.

Sem o binding `ACEITES_DB`, o endpoint retorna HTTP 503 e nenhum dado é gravado.

## Privacidade e operação

O banco conterá dados pessoais (nome, CPF/CNPJ, e-mail, telefone e IP). O acesso ao D1 deve permanecer restrito à conta Cloudflare da Rumos. Não expor endpoint de listagem pública.

O navegador não armazena esses dados para retomada. Guarda apenas um UUID aleatório, o estágio do fluxo e a hora em que a tentativa começou. O cliente pode descartar a retomada e iniciar nova contratação; o registro local expira automaticamente.

`POST /api/aceites` aceita `idempotency_key` em formato UUID. A primeira requisição cria o aceite e responde `201`; repetição com a mesma chave e os mesmos dados responde `200` com `reused: true`; a mesma chave com dados diferentes responde `409`. Clientes sem a chave recebem um UUID gerado no servidor, mas não têm proteção contra resposta ambígua.

## Cloudflare Turnstile

Use widgets diferentes para **Preview** e **produção**. Em cada ambiente, configure no Cloudflare Pages:

- `TURNSTILE_SITE_KEY`: sitekey pública do widget daquele ambiente;
- `TURNSTILE_SECRET_KEY`: chave secreta, cadastrada como secret e nunca colocada no código;
- `TURNSTILE_ALLOWED_HOSTNAMES`: lista separada por vírgulas, apenas com hostnames exatos, sem `https://`, porta ou caminho.

Exemplo de Preview com o endereço estável da branch:

```text
TURNSTILE_ALLOWED_HOSTNAMES=feat-marcas-rotina-interna-v.rumosadv-git.pages.dev
```

Exemplo de produção:

```text
TURNSTILE_ALLOWED_HOSTNAMES=rumosadv.com.br,www.rumosadv.com.br
```

No painel Turnstile, restrinja cada widget aos mesmos hostnames declarados no respectivo ambiente. Não reutilize as chaves de teste em produção. Após salvar os três bindings, refaça o deploy do ambiente correspondente.

O botão de contratação só é liberado após a prova do navegador. O servidor valida o token na API Siteverify, exige a ação `marcas_aceite`, confere o hostname permitido e falha fechado em timeout ou indisponibilidade. Tokens têm no máximo 2.048 caracteres, duram cinco minutos e são de uso único; por isso, qualquer falha pede uma prova nova.

O token é efêmero: não é gravado no D1, no armazenamento do navegador, nos eventos de marketing ou nos logs. Antes de validar um token, o servidor consulta a `idempotency_key`; assim, se o aceite já tiver sido persistido e apenas a resposta tiver se perdido, ele devolve o registro existente sem tentar reutilizar a prova. A retomada de um aceite já criado também segue diretamente para o checkout, sem novo desafio.

## Verificação antes de produção

1. Simular perda da resposta do aceite e comprovar que a repetição conserva o mesmo `aceite_id`.
2. Comprovar que duplo clique não cria dois aceites nem dois checkouts.
3. Comprovar que uma retomada abre apenas host HTTPS oficial do Asaas.
4. Comprovar que a opção de nova contratação limpa o estado local anterior.
5. Conferir os eventos no GTM sem contagem duplicada em checkout reutilizado.
6. No Preview, conferir que o endpoint de configuração devolve apenas `sitekey` e `action` e que, sem qualquer um dos três bindings, o botão permanece bloqueado.
7. Testar token válido, expiração, falha de rede e retomada idempotente; nenhum token pode aparecer no D1 ou no armazenamento do navegador.
8. Prosseguir com o UAT de pagamento, webhook e D1 descrito em `ASAAS_SETUP.md`.
