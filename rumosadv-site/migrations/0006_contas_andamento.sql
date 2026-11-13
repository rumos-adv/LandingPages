-- Andamento do pedido administrativo, exibido ao cliente no mesmo link da contratação.
-- JSON: [{ "etapa": "pedido_enviado", "em": "2026-11-20", "nota": "texto curto visível ao cliente" }]
ALTER TABLE contas_contratacoes ADD COLUMN andamento TEXT;
