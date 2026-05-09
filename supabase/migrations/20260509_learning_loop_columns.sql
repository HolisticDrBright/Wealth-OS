-- decision_log was missing two columns that the learning loop requires.
-- Without these, every insert from PaperBroker.fill() and the backfill endpoint
-- returns a PostgreSQL "column does not exist" error, so decision_log stays empty
-- and the learning loop never has data to work with.

ALTER TABLE decision_log
  ADD COLUMN IF NOT EXISTS asset_class       text,
  ADD COLUMN IF NOT EXISTS paper_position_id uuid REFERENCES paper_positions(id) ON DELETE SET NULL;

-- Fast lookup used by PaperBroker.checkAndExitPositions() inline grader
CREATE INDEX IF NOT EXISTS decision_log_paper_position_idx
  ON decision_log(paper_position_id)
  WHERE paper_position_id IS NOT NULL;
