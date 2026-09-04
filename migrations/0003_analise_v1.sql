ALTER TABLE aceites ADD COLUMN briefing_status TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE aceites ADD COLUMN briefing_completed_at TEXT;
ALTER TABLE aceites ADD COLUMN analysis_due_at TEXT;
ALTER TABLE aceites ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'aguardando';
ALTER TABLE aceites ADD COLUMN risk_level TEXT;
ALTER TABLE aceites ADD COLUMN report_file TEXT;
ALTER TABLE aceites ADD COLUMN delivered_at TEXT;
ALTER TABLE aceites ADD COLUMN credit_expires_at TEXT;
ALTER TABLE aceites ADD COLUMN registration_converted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_aceites_analysis_status ON aceites(analysis_status);

CREATE TABLE IF NOT EXISTS marca_briefings (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  mark_confirmed INTEGER NOT NULL DEFAULT 0,
  exact_mark TEXT NOT NULL,
  pronunciation TEXT,
  presentation_type TEXT NOT NULL,
  in_use INTEGER NOT NULL DEFAULT 0,
  first_use_date TEXT,
  current_goods_services TEXT NOT NULL,
  planned_goods_services TEXT,
  market_scope TEXT NOT NULL,
  intended_owner_type TEXT NOT NULL,
  intended_owner_document TEXT,
  company_exists INTEGER NOT NULL DEFAULT 0,
  company_main_activity TEXT,
  website_socials TEXT,
  known_conflicts TEXT,
  logo_url TEXT,
  information_confirmed INTEGER NOT NULL DEFAULT 0,
  temporal_search_ack INTEGER NOT NULL DEFAULT 0,
  data_use_authorized INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

CREATE TABLE IF NOT EXISTS marca_search_plans (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  normalized_mark TEXT NOT NULL,
  queries_json TEXT NOT NULL,
  suggested_classes_json TEXT NOT NULL DEFAULT '[]',
  related_classes_json TEXT NOT NULL DEFAULT '[]',
  needs_vienna INTEGER NOT NULL DEFAULT 0,
  lawyer_notes TEXT,
  status TEXT NOT NULL DEFAULT 'gerado',
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

CREATE TABLE IF NOT EXISTS marca_search_results (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'INPI',
  cutoff_at TEXT NOT NULL,
  query_term TEXT,
  query_type TEXT,
  process_number TEXT,
  mark_name TEXT NOT NULL,
  owner_name TEXT,
  filing_date TEXT,
  status TEXT,
  presentation TEXT,
  nice_classes TEXT,
  specification TEXT,
  source_url TEXT,
  text_similarity REAL NOT NULL DEFAULT 0,
  phonetic_similarity REAL NOT NULL DEFAULT 0,
  class_affinity REAL NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 0,
  relevance_level TEXT NOT NULL DEFAULT 'baixa',
  raw_json TEXT NOT NULL,
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

CREATE INDEX IF NOT EXISTS idx_marca_results_aceite ON marca_search_results(aceite_id);
CREATE INDEX IF NOT EXISTS idx_marca_results_relevance ON marca_search_results(aceite_id, relevance_score DESC);

CREATE TABLE IF NOT EXISTS marca_reviews (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cutoff_at TEXT,
  risk_level TEXT,
  executive_summary TEXT,
  recommendation TEXT,
  caveats TEXT,
  report_json TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

