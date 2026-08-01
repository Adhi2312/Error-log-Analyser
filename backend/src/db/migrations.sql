CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  filesize INT,
  uploaded_at TIMESTAMP DEFAULT now(),
  file_hash TEXT
);

CREATE TABLE IF NOT EXISTS errors (
  id SERIAL PRIMARY KEY,
  upload_id INT REFERENCES uploads(id) ON DELETE CASCADE,
  line_number INT,
  raw_text TEXT,
  redacted_text TEXT,
  fingerprint TEXT,
  severity_hint TEXT,
  processed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analyses (
  id SERIAL PRIMARY KEY,
  error_id INT REFERENCES errors(id) ON DELETE CASCADE,
  source TEXT,
  model TEXT,
  analysis_json JSONB,
  created_at TIMESTAMP DEFAULT now()
);
