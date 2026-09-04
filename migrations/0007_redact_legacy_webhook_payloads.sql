-- Eventos anteriores à auditoria minimizada podiam conter o JSON integral do
-- Asaas. Preservamos as colunas de correlação e descartamos o corpo legado.
-- Uma reentrega autenticada poderá ser adotada pelo handler usando
-- (id, event, checkout_id), passando então a armazenar o payload minimizado e
-- seu hash integral.
UPDATE asaas_webhook_events
SET payload = '{"legacy_redacted":true}',
    quarantine_reason = 'LEGACY_PAYLOAD_REDACTED'
WHERE processing_status = 'LEGACY_UNKNOWN'
  AND payload_sha256 IS NULL;
