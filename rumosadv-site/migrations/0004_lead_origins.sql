-- Origem dos leads das páginas de recuperação de contas (WhatsApp).
-- Aditiva: não altera tabelas existentes. Banco: ACEITES_DB (rumos-aceites).
-- Cada clique no botão de WhatsApp grava o código curto (Ref.) que vai na mensagem
-- e o identificador do clique do anúncio, para importar conversões offline no Google Ads.
CREATE TABLE IF NOT EXISTS lead_origins (
  ref TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  page TEXT NOT NULL,
  source TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbclid TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  clicks INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lead_origins_created ON lead_origins(created_at);
CREATE INDEX IF NOT EXISTS idx_lead_origins_gclid ON lead_origins(gclid);
