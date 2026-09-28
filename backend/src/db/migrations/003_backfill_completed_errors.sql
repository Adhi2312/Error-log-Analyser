UPDATE errors AS e
SET status = 'completed',
    completed_at = COALESCE(e.completed_at, e.processed_at, now())
WHERE e.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM analyses AS a
    WHERE a.error_id = e.id
  );
