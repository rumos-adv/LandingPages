# Checklist de lançamento — Rumos Marcas

Atualizado em 4 de setembro de 2026. Este documento separa o que já está pronto no produto, o que ainda precisa ser comprovado em ambiente de teste e o que depende de decisão do escritório.

## Regra de liberação

Não ativar Google Ads ou Meta, não promover a branch e não receber pagamento real enquanto houver item crítico aberto. Callback ou tela de sucesso não comprovam pagamento; a fonte de verdade é o webhook conciliado com o D1.

As escolhas que dependem do escritório estão consolidadas em `DECISOES_PENDENTES_LANCAMENTO_MARCAS.md`.

## 1. Produto e operação

- [x] Página de marcas, aceite e checkout estruturados.
- [x] Briefing pós-pagamento e plano de busca assistido.
- [x] Painel interno com pesquisa, revisão, relatório, entrega e conversão.
- [x] Modelo definitivo do relatório e roteiro de pós-venda.
- [x] Rotina interna e estrutura de pasta do caso documentadas.
- [x] Gate no código para iniciar o prazo visual apenas após confirmação humana do material.
- [x] Saída auditável para briefing com apresentação inicialmente indefinida.
- [x] Faixa interna de alertas para quarentena, inconsistências de pagamento e tentativas que exigem revisão.
- [x] Fuso `America/Sao_Paulo` configurado explicitamente no ambiente de Preview.
- [x] Feriados oficiais de 2026 — nacionais, estaduais e municipais de Campinas — configurados no Preview.
- [ ] Decidir se pontos facultativos ou recessos internos também deixarão de contar no prazo de 1 dia útil.
- [ ] Confirmar no Preview que a conferência humana do logotipo precede o início do prazo.
- [ ] Confirmar no Preview que pagamentos ou eventos ambíguos aparecem na fila de revisão do painel.
- [ ] Fazer uma entrega simulada completa, incluindo PDF conferido e comprovante arquivado.

## 2. Pagamento e auditoria

- [x] Termos versionados e conferidos pelo servidor.
- [x] Proteções contra duplo clique, requisições simultâneas e repetição de webhook.
- [x] Webhook com autenticação, limite de corpo, quarentena e registro auditável.
- [x] Consentimento de marketing antes de carregar Google ou Meta.
- [x] Turnstile implementado no aceite público, com validação no servidor e retomada idempotente.
- [ ] Criar o widget Turnstile de Preview, salvar sitekey/secret/hostname apenas no ambiente de Preview e validar o desafio no endereço da branch.
- [ ] Criar e configurar um widget Turnstile separado em produção somente depois da aprovação do UAT e de autorização expressa.
- [x] Aplicar e confirmar as migrations `0004` a `0008` no D1 de Preview — confirmado em 04/09/2026.
- [ ] Testar no Sandbox, de ponta a ponta: aceite, checkout, pagamento, webhook, `payment_status`, `paid_at`, tentativa e evento.
- [ ] Repetir o evento e simular ordem invertida para confirmar idempotência e proteção contra regressão.
- [ ] Após aprovação do Sandbox, configurar e testar produção em operação controlada e expressamente autorizada.

## 3. Segurança e privacidade

- [x] Tokens administrativos e de briefing não são expostos no conteúdo público.
- [x] O briefing público concluído não devolve os dados pessoais já informados.
- [x] Validação de CPF e CNPJ, inclusive CNPJ alfanumérico.
- [x] Implementar proteção antiabuso no aceite com Turnstile validado pelo servidor, sem registrar o token.
- [ ] Confirmar em Preview que a ausência, expiração e reutilização do desafio são recusadas antes de tráfego pago.
- [ ] Migrar a chave administrativa hoje guardada em texto simples para uma única guarda segura e, em seguida, rotacioná-la nos ambientes correspondentes.
- [ ] Revisar e aprovar a Política de Privacidade e Cookies para citar Asaas, Cloudflare, Tally, WhatsApp, Google e Meta, além de finalidade, base legal, retenção e direitos.
- [ ] Revisar no aceite a regra de início imediato, cancelamento e reembolso do serviço digital.
- [ ] Definir prazo de retenção e procedimento de exclusão dos dados e evidências.

## 4. Oferta e atendimento

- [x] Preço da análise inicial: R$ 390.
- [x] Crédito dos R$ 390 por 30 dias após a entrega registrado no fluxo.
- [x] Atendimento inicial por WhatsApp estruturado.
- [ ] Fixar preço, escopo e exclusões da etapa de pedido de registro.
- [ ] Confirmar se o número público `(19) 98911-9770` e o número da automação `(19) 99378-3011` têm funções deliberadamente distintas.
- [ ] Aprovar respostas-padrão sobre taxas do INPI, número de classes, marca nominativa/mista/figurativa, prazo e ausência de garantia.
- [ ] Definir quem cobre o atendimento durante indisponibilidades do advogado.

## 5. Marketing e mensuração

- [x] Google Tag Manager e Meta Pixel preparados com consentimento.
- [x] Campanhas Google e Meta preparadas e mantidas pausadas.
- [x] Perfil da Empresa no Google reforçado.
- [ ] Validar PageView e conversões no Preview e, depois, no domínio de produção.
- [ ] Conferir destinos, telefones, localização, horários e orçamento uma última vez.
- [ ] Definir eventos de negócio: lead iniciado, briefing concluído, checkout criado, pagamento confirmado e contratação do pedido.
- [ ] Somente então ativar campanhas, uma plataforma por vez, com teto diário aprovado.

## 6. Monitoramento após o lançamento

- [ ] Criar alerta para evento de pagamento em quarentena, tentativa de checkout parada e erro repetido de Function.
- [ ] Executar a abertura e o encerramento diário descritos em `ROTINA_INTERNA_MARCAS.md`.
- [ ] Revisar semanalmente: gasto, leads, pagamentos, entregas, conversões, CAC e termos de pesquisa.
- [ ] Manter um registro de incidentes e correções, sem copiar chaves ou dados pessoais desnecessários.

## Ordem recomendada para concluir

1. terminar os controles técnicos e executar todos os testes locais;
2. publicar a branch somente no Preview;
3. aplicar migration e variáveis de Preview;
4. executar o UAT completo no Asaas Sandbox;
5. aprovar privacidade, cancelamento/reembolso e oferta final;
6. fazer o teste controlado de produção;
7. validar mensuração e atendimento;
8. ativar as campanhas com monitoramento diário.
