-- Contratação da etapa administrativa (recuperação de contas): proposta → assinatura → pagamento → caso.
-- Aditiva. Banco: ACEITES_DB (rumos-aceites). Não altera as tabelas de Marcas.
CREATE TABLE IF NOT EXISTS contas_contratacoes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ref TEXT,
  proposta_numero TEXT,
  nome TEXT NOT NULL,
  cpf_cnpj TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  conta_numero TEXT,
  valor_centavos INTEGER NOT NULL DEFAULT 50000,
  max_parcelas INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'aguardando_assinatura',
  autentique_document_id TEXT,
  client_signature_id TEXT,
  sign_url TEXT,
  signed_at TEXT,
  asaas_checkout_id TEXT,
  checkout_url TEXT,
  payment_status TEXT,
  paid_at TEXT,
  caso_aberto_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_contr_doc ON contas_contratacoes(autentique_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_contr_checkout ON contas_contratacoes(asaas_checkout_id);
CREATE INDEX IF NOT EXISTS idx_contas_contr_status ON contas_contratacoes(status);
CREATE INDEX IF NOT EXISTS idx_contas_contr_ref ON contas_contratacoes(ref);

CREATE TABLE IF NOT EXISTS autentique_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  document_id TEXT,
  received_at TEXT NOT NULL
);
