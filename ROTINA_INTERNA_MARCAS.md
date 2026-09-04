# Rotina interna — Análise de viabilidade de marca

## Finalidade

Este é o procedimento operacional mínimo do serviço de análise de viabilidade. O painel é a fonte de verdade para pagamento, briefing, prazo, revisão, entrega e conversão. A pasta local guarda apenas os documentos e evidências do trabalho.

## Abertura diária (dias úteis)

1. Abrir o painel em `https://rumosadv.com.br/marcas/admin/analises/`.
2. Autenticar com `ANALYSIS_ADMIN_TOKEN` a partir do arquivo seguro. Nunca enviar a chave por WhatsApp, e-mail ou incluí-la na pasta do cliente.
3. Conferir a faixa **Alertas operacionais** antes da fila de casos. Webhook em quarentena, estado financeiro inconsistente, tentativa em revisão ou checkout em `CREATING` há mais de 65 minutos exigem reconciliação humana; não presumir pagamento nem orientar nova cobrança antes de entender a ocorrência.
4. Tratar a fila nesta ordem:
   - prazo vencido;
   - prazo que vence hoje;
   - logotipo aguardando conferência ou apresentação ainda indefinida;
   - pagamento confirmado com briefing pendente;
   - análise em pesquisa ou revisão;
   - crédito dos R$ 390 a vencer nos próximos 7 dias.
5. Para cada pagamento novo, conferir `PAID` no painel. A tela de sucesso do checkout, isoladamente, não comprova pagamento.
6. Gerar o link de briefing e enviar ao cliente. O link expira em 7 dias.
7. Se houver caso em `CREATING` ou `criando_pagamento`, conferir a hora da tentativa e os eventos antes de orientar novo clique. Esse estado é um claim de proteção e pode estar aguardando reconciliação com o Asaas.

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

O logotipo é obrigatório para apresentação mista ou figurativa. Sem um link válido para o arquivo, o briefing não pode ser concluído. Mesmo com o link, a conclusão deixa o caso em `aguardando_material`, sem vencimento. O advogado deve abrir o arquivo, verificar se está acessível e se corresponde ao sinal informado e, só então, clicar em **Confirmar material e iniciar prazo**. A repetição desse clique preserva a primeira data de vencimento.

Para apresentação nominativa, o arquivo não é obrigatório e o prazo começa automaticamente na conclusão. Para apresentação indefinida, o caso permanece em `aguardando_definicao`, sem prazo; após obter a decisão do cliente, escolher a modalidade e usar **Registrar definição** no painel. A ação fica registrada no histórico operacional. Se a escolha for nominativa, o prazo começa; se for mista ou figurativa, é necessário informar o link e depois executar a conferência humana do material.

O vencimento é calculado no fuso definido em `ANALYSIS_TIME_ZONE` — por padrão, `America/Sao_Paulo` — preservando o horário local da conclusão e avançando para o próximo dia útil. Sábados, domingos e as datas de `ANALYSIS_HOLIDAYS` não entram na contagem. As datas da variável devem estar no formato `AAAA-MM-DD`; revisar a lista de feriados no início de cada ano e sempre que houver alteração operacional.

Se o briefing estiver incompleto, registrar a pendência nas notas do plano e solicitar a complementação antes de concluir a análise. Depois de concluído, o briefing público é imutável. Qualquer correção posterior deve ser recebida por escrito, preservada na pasta do caso e avaliada pelo advogado quanto ao impacto no escopo e no prazo; não substituir silenciosamente as respostas que deram início à análise.

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
3. Conferir no webhook o evento `CHECKOUT_PAID`, o `externalReference` e o registro correspondente em `asaas_webhook_events`.
4. Confirmar que `payment_status = PAID` e que `paid_at` está preenchido no aceite.
5. Se o Asaas confirmar o pagamento e o painel não atualizar, interromper a automação e corrigir a integração antes de alterar dados manualmente.

O `externalReference` atual tem o formato `<aceite_id>:<tentativa_id>`. Ele permite reconciliar um checkout criado no Asaas cuja resposta não tenha sido persistida localmente. A referência antiga composta apenas pelo aceite não deve ser usada para substituir claim de tentativa nova.

### Checkout em criação, cancelado ou expirado

- `CREATING`/`criando_pagamento` indica claim temporário. Não remover o claim nem abrir manualmente outro checkout enquanto a tentativa puder estar ativa no Asaas.
- Em falha de rede ou resultado ambíguo, aguardar a reconciliação por webhook e conferir o Asaas antes de repetir.
- O claim só se torna retomável depois da janela de segurança da aplicação; atualmente, 65 minutos. Mesmo depois dela, conferir se não existe checkout ou pagamento externo antes de orientar nova tentativa.
- Checkout `CANCELED` ou `EXPIRED` pode ser substituído por uma nova tentativa pela própria página.
- Checkout ativo é reutilizado. O sistema pode reconstruir uma URL oficial de fallback pelo identificador quando o link armazenado estiver ausente ou não for confiável; não montar nem enviar URLs alternativas manualmente.
- `PAID` é terminal: evento atrasado de criação, cancelamento ou expiração não deve rebaixar o pagamento e o sistema não deve criar outro checkout.
- O ID do evento torna o webhook idempotente. Entregas repetidas idênticas são esperadas; colisão de ID com conteúdo diferente ou evento não reconciliado exige investigação.

### `CHECKOUT_STATE_REQUIRES_REVIEW`

Esse código significa que o estado local do checkout não permite determinar com segurança a propriedade da tentativa. Procedimento:

1. interromper novas tentativas para o aceite e anotar o `aceite_id`, a data, a hora e a mensagem, sem copiar chaves ou tokens;
2. conferir no D1 `asaas_checkout_id`, `payment_status`, `paid_at` e os eventos em `asaas_webhook_events`;
3. no Asaas, localizar todos os checkouts relacionados ao aceite e comparar identificador, situação e `externalReference`;
4. conferir os logs estruturados da Function para identificar claim malformado, conflito de tentativa ou falha de persistência;
5. se houver mais de um checkout, pagamento confirmado ou referências divergentes, manter o caso bloqueado para revisão técnica;
6. somente retomar depois de identificar o checkout canônico e confirmar que não haverá cobrança duplicada. Não apagar o claim para “destravar” e não marcar `PAID` com base em callback, página de sucesso ou captura de tela.

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

### Fuso horário ou feriado incorreto

1. interromper a emissão de novos links de briefing no ambiente afetado;
2. conferir `ANALYSIS_TIME_ZONE` e `ANALYSIS_HOLIDAYS` no Cloudflare, sem inserir descrições junto das datas;
3. usar somente datas `AAAA-MM-DD`, separadas por vírgula, ponto e vírgula ou espaço, ou uma lista JSON de datas;
4. testar o cálculo em Preview antes de repetir a configuração em produção;
5. revisar manualmente os casos cujo prazo possa ter sido calculado durante a configuração incorreta e avisar o cliente se houver impacto.

## Liberação para produção

Não promover a integração nem liberar anúncios com tráfego real antes de um teste controlado em Preview/Sandbox. O roteiro mínimo deve comprovar:

1. aceite fictício criado;
2. checkout criado e retomado sem duplicação;
3. pagamento de teste processado;
4. webhook autenticado recebido;
5. `payment_status = PAID` e `paid_at` preenchido;
6. evento registrado em `asaas_webhook_events`;
7. briefing nominativo concluído e prazo calculado;
8. briefing misto sem logotipo recusado e, com logotipo, aceito;
9. vencimento correto ao atravessar fim de semana e feriado configurado;
10. relatório e pós-venda revisados pelo operador.

Registrar evidências e a aprovação do UAT. A existência das funções ou deste roteiro não significa que o teste real já foi concluído. Em produção, qualquer pagamento controlado exige autorização específica antes da operação financeira.

## Revisão semanal

Toda sexta-feira:

- contar análises pagas, entregues e convertidas;
- revisar casos vencidos ou parados;
- revisar créditos que vencem na semana seguinte;
- selecionar dúvidas recorrentes para melhorar briefing, mensagens e anúncios;
- fazer cópia de segurança das pastas concluídas.
