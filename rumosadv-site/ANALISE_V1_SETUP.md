# Análise de viabilidade de marca — V1 assistida

## Escopo

1. o advogado gera um link de briefing para um aceite com pagamento confirmado;
2. o cliente conclui o briefing em `/marcas/briefing/`;
3. o sistema gera variações determinísticas de busca;
4. o advogado confirma classes de Nice e classes afins;
5. resultados exportados ou copiados do INPI são importados em JSON;
6. o sistema calcula uma triagem de relevância textual, fonética e de afinidade;
7. o advogado revisa os achados e aprova a minuta estruturada.
8. o painel abre a versão A4 para impressão ou salvamento em PDF;
9. após a aprovação jurídica, o advogado registra a entrega e o sistema calcula o crédito de 30 dias;
10. a contratação posterior do pedido pode ser registrada no mesmo caso.

A pontuação não é parecer jurídico e nunca substitui a revisão profissional.

## Configuração do Preview

1. aplicar `migrations/0003_analise_v1.sql` no D1 de Preview;
2. criar os secrets `ANALYSIS_ADMIN_TOKEN` e `BRIEFING_SIGNING_SECRET`, distintos e aleatórios;
3. manter o binding `ACEITES_DB`;
4. abrir `/marcas/admin/analises/` e autenticar com `ANALYSIS_ADMIN_TOKEN`.

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

`class_affinity` é informado pelo advogado entre 0 e 1. A V1 não presume afinidade apenas pelo número da classe.

## Entrega e conversão

- `Abrir relatório para PDF` exige uma minuta previamente salva;
- antes de `Marcar como entregue`, o operador informa a referência do PDF efetivamente salvo e enviado; a V1 registra a referência, mas não armazena o arquivo;
- `Marcar como entregue` exige revisão marcada como aprovada;
- a entrega preenche `delivered_at` e `report_file`, muda `analysis_status` para `entregue` e calcula `credit_expires_at` em 30 dias;
- entrega e conversão são idempotentes: cliques repetidos preservam as datas originais;
- `Registrar contratação do pedido` preenche `registration_converted_at` somente depois da entrega;
- o painel oferece mensagens prontas para confirmação de pagamento, lembrete de briefing, entrega e oferta do registro.

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
