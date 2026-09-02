# Rotina interna — Análise de viabilidade de marca

## Finalidade

Este é o procedimento operacional mínimo do serviço de análise de viabilidade. O painel é a fonte de verdade para pagamento, briefing, prazo, revisão, entrega e conversão. A pasta local guarda apenas os documentos e evidências do trabalho.

## Abertura diária (dias úteis)

1. Abrir o painel em `https://rumosadv.com.br/marcas/admin/analises/`.
2. Autenticar com `ANALYSIS_ADMIN_TOKEN` a partir do arquivo seguro. Nunca enviar a chave por WhatsApp, e-mail ou incluí-la na pasta do cliente.
3. Tratar a fila nesta ordem:
   - prazo vencido;
   - prazo que vence hoje;
   - pagamento confirmado com briefing pendente;
   - análise em pesquisa ou revisão;
   - crédito dos R$ 390 a vencer nos próximos 7 dias.
4. Para cada pagamento novo, conferir `PAID` no painel. A tela de sucesso do checkout, isoladamente, não comprova pagamento.
5. Gerar o link de briefing e enviar ao cliente. O link expira em 7 dias.

## Pasta do caso

Criar a pasta com a ferramenta `Novo-Caso-Marcas.ps1`, usando o `aceite_id` exibido no painel e o nome da marca. Estrutura:

```text
AAAA-MM-DD_ID_MARCA/
  01_briefing/
  02_evidencias_inpi/
  03_analise/
  04_relatorio/
  05_entrega/
  06_registro/
  LEIA-ME.txt
```

Regras:

- não guardar tokens, chaves de API ou senhas na pasta do caso;
- preservar os arquivos originais enviados pelo cliente;
- salvar capturas, exportações e links com data de corte;
- nomear o relatório final como `relatorio-viabilidade-MARCA-AAAA-MM-DD.pdf`;
- informar esse mesmo nome no campo **Referência do PDF efetivamente enviado**.

## Início e prazo

O prazo de 1 dia útil começa somente quando existirem, em conjunto:

1. pagamento confirmado (`payment_status = PAID`);
2. briefing concluído;
3. logotipo ou outro arquivo necessário recebido, quando aplicável.

Se o briefing estiver incompleto, registrar a pendência nas notas do plano e solicitar a complementação antes de concluir a análise.

## Pesquisa, revisão e entrega

1. Conferir o briefing e a apresentação pretendida.
2. Revisar o plano de consultas e as classes principais e afins.
3. Realizar as buscas no INPI, fixando data e hora de corte.
4. Salvar as evidências em `02_evidencias_inpi`.
5. Importar os resultados relevantes no painel.
6. Preencher síntese, recomendação e ressalvas.
7. Marcar a minuta como revisada somente após revisão pessoal do advogado.
8. Abrir o relatório, salvar o PDF em `04_relatorio` e conferir visualmente o arquivo.
9. Enviar PDF e resumo ao cliente; guardar comprovante em `05_entrega`.
10. Somente depois do envio, registrar a entrega no painel. O crédito de 30 dias é calculado a partir desse registro.

## Pós-venda

- **Favorável:** oferecer imediatamente o protocolo, esclarecendo honorários, taxas e escopo.
- **Favorável com ressalvas:** propor conversa breve e estratégia de apresentação, especificação ou classes.
- **Risco elevado:** apresentar alternativas e não induzir depósito sem estratégia específica.
- **Desaconselhado:** oferecer nova construção de sinal ou nova pesquisa.
- Nos 7 dias anteriores ao vencimento do crédito, enviar uma retomada objetiva.
- Registrar **contratação do pedido** somente depois da confirmação comercial efetiva.

## Encerramento diário

1. Confirmar que todo caso trabalhado teve evidências salvas.
2. Verificar se nenhuma entrega ficou sem `report_file` e `delivered_at`.
3. Conferir a fila de prazos novamente.
4. Manter o token fora das pastas de clientes e fechar a sessão do painel em dispositivo compartilhado.

## Falhas e contingência

### Pagamento realizado, mas não aparece como `PAID`

1. Não liberar o serviço apenas com captura do cliente.
2. Conferir a cobrança no Asaas pelo identificador do checkout.
3. Conferir o webhook e o registro no D1.
4. Se o Asaas confirmar o pagamento e o painel não atualizar, interromper a automação e corrigir a integração antes de alterar dados manualmente.

### Link de briefing expirado ou inválido

Gerar novo link no painel. Não reutilizar nem tentar editar o token anterior.

### Painel não autorizado

1. Confirmar que está usando a chave de produção, sem espaços antes ou depois.
2. Reabrir o painel e colar novamente; a chave fica apenas na sessão do navegador.
3. Se persistir, conferir o secret `ANALYSIS_ADMIN_TOKEN` no ambiente **Production** do Cloudflare.
4. Nunca substituir a chave sem atualizar o arquivo seguro do escritório.

### Prazo em risco

Priorizar o caso e avisar o cliente antes do vencimento. Não registrar a entrega antes do envio real do PDF.

### PDF incorreto depois da entrega

Preservar o PDF anterior, gerar versão corrigida com sufixo `-v2`, reenviar e guardar ambos com os comprovantes. O painel preserva a primeira data de entrega; documentar a correção na pasta do caso.

## Revisão semanal

Toda sexta-feira:

- contar análises pagas, entregues e convertidas;
- revisar casos vencidos ou parados;
- revisar créditos que vencem na semana seguinte;
- selecionar dúvidas recorrentes para melhorar briefing, mensagens e anúncios;
- fazer cópia de segurança das pastas concluídas.

