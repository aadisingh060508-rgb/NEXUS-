-- =============================================================================
-- 09_secure_pipeline_and_heartbeat.sql
-- Purpose: Secure the monitoring pipeline and add heartbeat/online-status.
--   1. Add last_seen_at to users (heartbeat column)
--   2. Fix browser_activity_logs INSERT policy (ownership check, no more WITH CHECK (true))
--   3. Fix delete_all_activity_logs() to be tenant-scoped via auth.uid()
--   4. Add employee_activity_logs, browser_activity_logs, users to supabase_realtime publication
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

-- ── 1. Heartbeat column ──────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- ── 2. Fix browser_activity_logs INSERT policy ───────────────────────────────
-- Drop the insecure wide-open INSERT policy
DROP POLICY IF EXISTS "allow_insert_browser_activity" ON public.browser_activity_logs;

-- New INSERT policy: only authenticated users, and employee_id must match the caller
CREATE POLICY "authenticated_insert_browser_activity"
ON public.browser_activity_logs FOR INSERT TO authenticated
WITH CHECK (safe_employee_uuid(employee_id) = auth.uid());

-- ── 3. Fix delete_all_activity_logs() to be tenant-scoped ────────────────────
CREATE OR REPLACE FUNCTION delete_all_activity_logs()
RETURNS void AS $$
BEGIN
  -- Delete this admin's own logs + their connected employees' logs
  DELETE FROM public.employee_activity_logs
  WHERE user_id = auth.uid()
     OR user_id IN (SELECT id FROM public.users WHERE admin_id = auth.uid());

  -- Also delete browser activity logs for the same scope
  DELETE FROM public.browser_activity_logs
  WHERE safe_employee_uuid(employee_id) = auth.uid()
     OR safe_employee_uuid(employee_id) IN (SELECT id FROM public.users WHERE admin_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. Add DELETE policy for browser_activity_logs ───────────────────────────
DROP POLICY IF EXISTS "scoped_delete_browser_activity" ON public.browser_activity_logs;
CREATE POLICY "scoped_delete_browser_activity"
ON public.browser_activity_logs FOR DELETE TO authenticated
USING (
  safe_employee_uuid(employee_id) = auth.uid()
  OR safe_employee_uuid(employee_id) IN (SELECT id FROM public.users WHERE admin_id = auth.uid())
);

-- ── 5. Realtime publication ──────────────────────────────────────────────────
-- Add employee_activity_logs to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'employee_activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_activity_logs;
  END IF;
END $$;

-- Add browser_activity_logs to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'browser_activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE browser_activity_logs;
  END IF;
END $$;

-- Add users to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE users;
  END IF;
END $$;
