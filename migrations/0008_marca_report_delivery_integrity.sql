-- Vincula a entrega ao conteúdo e à versão exatos da revisão aprovada.
ALTER TABLE marca_reviews ADD COLUMN report_sha256 TEXT;
ALTER TABLE aceites ADD COLUMN delivered_report_sha256 TEXT;
ALTER TABLE aceites ADD COLUMN delivered_review_updated_at TEXT;
