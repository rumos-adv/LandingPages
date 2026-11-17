-- Serviço contratado: 'whatsapp_adm' (etapa administrativa de WhatsApp, padrão) ou
-- 'dinheiro_retido' (medida judicial por saldo retido ou loja suspensa), com rito e opção de honorários.
ALTER TABLE contas_contratacoes ADD COLUMN servico TEXT NOT NULL DEFAULT 'whatsapp_adm';
ALTER TABLE contas_contratacoes ADD COLUMN rito TEXT;
ALTER TABLE contas_contratacoes ADD COLUMN opcao TEXT;
