# Análise de viabilidade de marca — V1 assistida

## Escopo

1. o advogado gera um link de briefing para um aceite com pagamento confirmado;
2. o cliente conclui o briefing em `/marcas/briefing/`;
3. o sistema gera variações determinísticas de busca e, quando houver elemento visual ou apresentação indefinida, mantém o prazo suspenso até a ação humana correspondente;
4. o advogado confirma classes de Nice e classes afins;
5. resultados exportados ou copiados do INPI são importados em JSON;
6. o operador confirma, com data de corte e identificação, que executou todas as consultas do plano vigente — inclusive quando nenhuma anterioridade foi encontrada;
7. o sistema calcula uma triagem de relevância textual, fonética e de afinidade;
8. o advogado revisa os achados e aprova a minuta estruturada;
9. o painel abre a versão A4 para impressão ou salvamento em PDF;
10. após a aprovação jurídica, o advogado registra a entrega e o sistema calcula o crédito de 30 dias;
11. a contratação posterior do pedido pode ser registrada no mesmo caso.

A pontuação não é parecer jurídico e nunca substitui a revisão profissional.

## Configuração do Preview

1. em um ambiente que já recebeu `0001` a `0003`, aplicar `migrations/0004_asaas_checkout_history.sql`, `migrations/0005_marca_operational_events.sql`, `migrations/0006_marca_search_completion.sql`, `migrations/0007_redact_legacy_webhook_payloads.sql` e `migrations/0008_marca_report_delivery_integrity.sql`, nessa ordem, no D1 de Preview antes de publicar o código; em banco novo, executar `0001` a `0008` em ordem;
2. criar os secrets `ANALYSIS_ADMIN_TOKEN` e `BRIEFING_SIGNING_SECRET`, distintos e aleatórios;
3. manter o binding `ACEITES_DB`;
4. configurar `ANALYSIS_TIME_ZONE=America/Sao_Paulo`;
5. configurar `ANALYSIS_HOLIDAYS` com os feriados em que o escritório não contará prazo, sempre no formato `AAAA-MM-DD`;
6. abrir `/marcas/admin/analises/` e autenticar com `ANALYSIS_ADMIN_TOKEN`.

`ANALYSIS_TIME_ZONE` e `ANALYSIS_HOLIDAYS` são variáveis de configuração, não segredos. O fuso padrão é `America/Sao_Paulo`, mas deve ser informado explicitamente em cada ambiente para facilitar a auditoria.

`ANALYSIS_HOLIDAYS` aceita datas separadas por vírgula, ponto e vírgula ou espaço. Também aceita uma lista JSON. Exemplos equivalentes:

```text
2026-09-07,2026-10-12,2026-11-02
```

```json
["2026-09-07", "2026-10-12", "2026-11-02"]
```

Manter apenas datas válidas no formato `AAAA-MM-DD`, sem descrições ou intervalos. A lista deve abranger os feriados nacionais, estaduais, municipais e outros dias que, por decisão operacional do escritório, não serão contados. Fins de semana são excluídos automaticamente. Atualizar e revisar a lista antes de cada ano e antes de promover uma configuração para produção.

## Liberação, conclusão e prazo do briefing

- o link de briefing só é liberado quando `payment_status = PAID`; callback ou tela de sucesso do Asaas não comprovam pagamento;
- para apresentação **mista** ou **figurativa**, o cliente deve informar um link válido para o logotipo antes de concluir;
- para apresentação **mista** ou **figurativa**, a conclusão deixa o caso em `aguardando_material`, sem vencimento; o advogado deve abrir e conferir o arquivo e usar **Confirmar material e iniciar prazo** no painel;
- para apresentação **nominativa**, o logotipo não é requisito e a conclusão inicia automaticamente o prazo de 1 dia útil;
- para apresentação **indefinida**, a conclusão deixa o caso em `aguardando_definicao`, sem vencimento e sem permitir a confirmação de material; a modalidade deve ser definida com o cliente antes da análise;
- no painel, a ação **Registrar definição** transforma a apresentação indefinida em nominativa, mista ou figurativa e grava a decisão no histórico operacional; nominativa inicia o prazo, enquanto mista ou figurativa exigem link válido e seguem para a conferência humana do material;
- o vencimento avança para o próximo dia útil, no mesmo horário local, excluindo sábado, domingo e as datas de `ANALYSIS_HOLIDAYS`;
- configuração de fuso ou feriados inválida deve ser corrigida no Cloudflare; não contornar o erro registrando prazo manual antes de entender a causa;
- depois de concluído, o briefing é imutável pelo link público. Nova tentativa recebe resposta de conflito, preservando a versão que iniciou a análise;
- se o cliente pedir correção após a conclusão, o advogado deve guardar a solicitação, avaliar o impacto no escopo e registrar a complementação na pasta do caso. Não editar silenciosamente o briefing original.

Antes de produção, validar em Preview um caso nominativo, um caso misto com logotipo antes e depois da confirmação humana, a recusa de caso misto sem logotipo, um caso com apresentação indefinida, um vencimento que atravesse fim de semana e outro que atravesse feriado configurado. Este documento não registra esses testes como já concluídos.

## Formato de importação

O painel recebe uma lista JSON com até 250 itens. Exemplo:

```json
[
  {
    "mark_name": "Montanha Café",
    "process_number": "000000000",
    "owner_name": "Titular exemplo",
    "status": "Pedido de registro",
    "nice_classes": "30",
    "specification": "Café e produtos correlatos",
    "source_url": "https://busca.inpi.gov.br/",
    "class_affinity": 1
  }
]
```

`class_affinity` é informado pelo advogado entre 0 e 1. A V1 não presume afinidade apenas pelo número da classe. Salvar novamente o plano invalida o conjunto anterior e exige confirmação explícita para remover todos os resultados já importados; depois disso, os resultados pertinentes ao plano revisado devem ser importados de novo.

## Entrega e conversão

- `Abrir relatório para PDF` exige uma minuta previamente salva;
- antes de `Marcar como entregue`, o operador abre a versão final pelo botão do painel e informa a referência do PDF efetivamente salvo e enviado; a V1 registra a referência, o hash SHA-256 do relatório e a versão da revisão, mas não armazena o arquivo;
- `Marcar como entregue` exige revisão marcada como aprovada;
- a entrega preenche `delivered_at`, `report_file`, `delivered_report_sha256` e `delivered_review_updated_at`, muda `analysis_status` para `entregue` e calcula `credit_expires_at` em 30 dias; se a minuta mudar depois de o PDF ser aberto, a entrega é recusada até que a versão atual seja aberta novamente;
- entrega e conversão são idempotentes: cliques repetidos preservam as datas originais;
- `Registrar contratação do pedido` preenche `registration_converted_at` somente depois da entrega;
- o painel oferece mensagens prontas para confirmação de pagamento, lembrete de briefing, entrega e oferta do registro.

## Relação com o checkout

Cada nova tentativa de checkout usa um `externalReference` próprio, formado pelo identificador do aceite e pelo identificador da tentativa. Claims temporários protegem contra criação concorrente, e o webhook pode reconciliar uma criação cuja resposta ao navegador tenha sido inconclusiva. Checkout cancelado ou expirado admite nova tentativa; `PAID` é terminal e impede novo checkout. A rotina completa e a contingência `CHECKOUT_STATE_REQUIRES_REVIEW` estão documentadas em `ASAAS_SETUP.md` e `ROTINA_INTERNA_MARCAS.md`.

## Relatório definitivo

- a minuta agora incorpora contexto do negócio, apresentação, classes principais e afins, consultas e resultados relevantes;
- `Abrir relatório para PDF` aplica a estrutura definitiva de identificação, conclusão, estratégia de proteção, metodologia, anterioridades, análise, limitações e próximos passos;
- o arquivo `MODELO_RELATORIO_DEFINITIVO.md` contém a regra editorial e o checklist de qualidade;
- `output/pdf/MODELO_DEFINITIVO_RELATORIO_VIABILIDADE_MARCA.pdf` é a amostra visual com dados fictícios;
- a amostra nunca deve ser usada para orientar um caso real.

## Pós-venda assistido

- o painel oferece mensagens manuais D0, D3, D7, D15 e D25, além de encerramento;
- as mensagens variam conforme `risk_level` e usam a data real de `credit_expires_at` quando disponível;
- a cadência é condicional e deve parar em caso de resposta, recusa, contratação ou pedido para não contatar;
- casos de risco elevado ou desaconselhados não recebem indução para depósito contrário à recomendação;
- consulte `ROTEIRO_POS_VENDA_MARCAS.md` antes de enviar as mensagens.
