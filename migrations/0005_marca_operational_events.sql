CREATE TABLE IF NOT EXISTS marca_operational_events (
  id TEXT PRIMARY KEY,
  aceite_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('PRESENTATION_RESOLVED', 'MATERIAL_CONFIRMED')),
  created_at TEXT NOT NULL,
  previous_analysis_status TEXT,
  new_analysis_status TEXT,
  previous_presentation_type TEXT,
  new_presentation_type TEXT,
  analysis_due_at TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (aceite_id) REFERENCES aceites(id)
);

CREATE INDEX IF NOT EXISTS idx_marca_operational_events_case_time
  ON marca_operational_events(aceite_id, created_at DESC);
