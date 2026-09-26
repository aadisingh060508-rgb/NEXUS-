-- 07_allow_insert_browser_activity.sql

-- Add the missing INSERT policy for browser_activity_logs
-- This allows the employee-agent (running via anon key or authenticated) to insert logs.
DROP POLICY IF EXISTS "allow_insert_browser_activity" ON browser_activity_logs;

CREATE POLICY "allow_insert_browser_activity"
ON browser_activity_logs FOR INSERT TO anon, authenticated
WITH CHECK (true);
