-- Contatos deixados pelo formulário das páginas de WhatsApp banido, para quem não consegue
-- abrir o WhatsApp no próprio aparelho. O vínculo com o anúncio é feito pelo ref (lead_origins).
CREATE TABLE IF NOT EXISTS contas_contatos (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ref TEXT,
  page TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT,
  preferencia TEXT NOT NULL,
  numero_banido TEXT,
  relato TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  atendido_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contas_contatos_status ON contas_contatos (status, created_at);
