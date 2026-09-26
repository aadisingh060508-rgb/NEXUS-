-- -----------------------------------------------------------------------------
-- 3. browser_activity_logs
-- -----------------------------------------------------------------------------
CREATE TABLE browser_activity_logs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id               text NOT NULL,
    url                       text NOT NULL,
    domain                    text,
    page_title                text,
    visited_at                timestamptz NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE browser_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "browser_activity_insert_all"
ON browser_activity_logs FOR INSERT
WITH CHECK (true);

CREATE POLICY "browser_activity_select_all"
ON browser_activity_logs FOR SELECT
USING (true);

