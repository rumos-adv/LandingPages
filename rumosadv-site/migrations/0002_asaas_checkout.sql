ALTER TABLE aceites ADD COLUMN asaas_checkout_id TEXT;
ALTER TABLE aceites ADD COLUMN asaas_checkout_url TEXT;
ALTER TABLE aceites ADD COLUMN payment_status TEXT;
ALTER TABLE aceites ADD COLUMN paid_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_aceites_asaas_checkout_id ON aceites(asaas_checkout_id);
CREATE INDEX IF NOT EXISTS idx_aceites_payment_status ON aceites(payment_status);

CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  checkout_id TEXT,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_checkout_id ON asaas_webhook_events(checkout_id);
