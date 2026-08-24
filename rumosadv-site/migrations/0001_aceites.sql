CREATE TABLE IF NOT EXISTS aceites (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  nome TEXT NOT NULL,
  cpf_cnpj TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  marca TEXT NOT NULL,
  term_version TEXT NOT NULL,
  term_hash TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  consent INTEGER NOT NULL DEFAULT 1 CHECK (consent = 1),
  status TEXT NOT NULL DEFAULT 'aceito'
);

CREATE INDEX IF NOT EXISTS idx_aceites_created_at ON aceites(created_at);
CREATE INDEX IF NOT EXISTS idx_aceites_email ON aceites(email);
CREATE INDEX IF NOT EXISTS idx_aceites_status ON aceites(status);
