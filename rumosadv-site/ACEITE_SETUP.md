# Aceite online — Análise de Viabilidade de Marca

Implementação inicial de `/marcas/aceite/`.

## O que já está no código

- Página de contratação e termo versão 1.0.
- Registro do hash SHA-256 do texto do termo no navegador.
- Pages Function `POST /api/aceites`.
- Persistência prevista em Cloudflare D1.
- Registro de data/hora, IP, user-agent, versão e hash do termo.
- Evento GTM `analise_viabilidade_aceite` após sucesso.

## Configuração necessária no Cloudflare antes de publicar em produção

1. Criar um banco D1 para os aceites (ex.: `rumos-aceites`).
2. Executar `migrations/0001_aceites.sql` nesse banco.
3. No projeto Cloudflare Pages `rumosadv-git`, adicionar um binding D1 com o nome **`ACEITES_DB`** apontando para o banco criado.
4. Fazer um deploy da branch/preview e testar o formulário antes do merge.

Sem o binding `ACEITES_DB`, o endpoint retorna HTTP 503 e nenhum dado é gravado.

## Privacidade e operação

O banco conterá dados pessoais (nome, CPF/CNPJ, e-mail, telefone e IP). O acesso ao D1 deve permanecer restrito à conta Cloudflare da Rumos. Não expor endpoint de listagem pública.

## Próximas etapas sugeridas

- confirmação de pagamento;
- e-mail/WhatsApp de confirmação;
- briefing pós-contratação;
- geração de comprovante/PDF imutável do aceite;
- painel interno/CRM.
