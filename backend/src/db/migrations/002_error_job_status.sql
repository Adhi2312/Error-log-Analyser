ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP;

ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

ALTER TABLE errors
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'errors_status_check'
      AND conrelid = 'errors'::regclass
  ) THEN
    ALTER TABLE errors
      ADD CONSTRAINT errors_status_check
      CHECK (status IN (
        'pending',
        'queued',
        'queue_failed',
        'processing',
        'retrying',
        'completed',
        'failed'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS errors_upload_status_idx
  ON errors (upload_id, status);
