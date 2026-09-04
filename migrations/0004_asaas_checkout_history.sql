CREATE TABLE asaas_checkout_attempts (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL,
  external_reference TEXT NOT NULL UNIQUE,
  checkout_id TEXT UNIQUE,
  checkout_url TEXT,
  state TEXT NOT NULL DEFAULT 'CREATING'
    CHECK (state IN (
      'CREATING',
      'AWAITING_PAYMENT',
      'PAID',
      'CANCELED',
      'EXPIRED',
      'SUPERSEDED',
      'CREATE_FAILED',
      'REQUIRES_REVIEW'
    )),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_at TEXT,
  paid_at TEXT,
  last_event TEXT,
  last_event_at TEXT,
  failure_reason TEXT,
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

-- Materializa o checkout vigente das instalações anteriores à tabela de
-- histórico. Isso preserva o vínculo mesmo depois que uma nova tentativa
-- substituir as colunas-resumo de aceites.
INSERT OR IGNORE INTO asaas_checkout_attempts (
  id,
  aceite_id,
  external_reference,
  checkout_id,
  checkout_url,
  state,
  is_current,
  created_at,
  updated_at,
  paid_at,
  failure_reason
)
SELECT
  'legacy-' || id,
  id,
  'legacy:' || id || ':' || asaas_checkout_id,
  asaas_checkout_id,
  asaas_checkout_url,
  CASE
    WHEN paid_at IS NOT NULL OR UPPER(COALESCE(payment_status, '')) = 'PAID' THEN 'PAID'
    WHEN UPPER(COALESCE(payment_status, '')) = 'CANCELED' THEN 'CANCELED'
    WHEN UPPER(COALESCE(payment_status, '')) = 'EXPIRED' THEN 'EXPIRED'
    ELSE 'AWAITING_PAYMENT'
  END,
  1,
  created_at,
  COALESCE(paid_at, created_at),
  paid_at,
  'MIGRATED_LEGACY_SUMMARY'
FROM aceites
WHERE asaas_checkout_id IS NOT NULL
  AND TRIM(asaas_checkout_id) <> ''
  AND LOWER(asaas_checkout_id) NOT LIKE 'creating:%';

CREATE UNIQUE INDEX idx_asaas_attempts_one_current
  ON asaas_checkout_attempts(aceite_id)
  WHERE is_current = 1;

CREATE INDEX idx_asaas_attempts_aceite_created
  ON asaas_checkout_attempts(aceite_id, created_at DESC);

CREATE INDEX idx_asaas_attempts_state
  ON asaas_checkout_attempts(state);

ALTER TABLE asaas_webhook_events ADD COLUMN processing_status TEXT
  DEFAULT 'LEGACY_UNKNOWN'
  CHECK (processing_status IN (
    'RECEIVED',
    'PROCESSED',
    'IGNORED',
    'QUARANTINED',
    'LEGACY_UNKNOWN'
  ));
ALTER TABLE asaas_webhook_events ADD COLUMN quarantine_reason TEXT;
ALTER TABLE asaas_webhook_events ADD COLUMN aceite_id TEXT;
ALTER TABLE asaas_webhook_events ADD COLUMN attempt_id TEXT;
ALTER TABLE asaas_webhook_events ADD COLUMN processed_at TEXT;
ALTER TABLE asaas_webhook_events ADD COLUMN payload_sha256 TEXT;

UPDATE asaas_webhook_events
SET processing_status = 'LEGACY_UNKNOWN'
WHERE processing_status IS NULL;

CREATE INDEX idx_asaas_webhook_events_processing_status
  ON asaas_webhook_events(processing_status);

CREATE INDEX idx_asaas_webhook_events_aceite_id
  ON asaas_webhook_events(aceite_id);
