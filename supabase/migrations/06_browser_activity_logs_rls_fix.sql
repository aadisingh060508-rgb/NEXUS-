-- =============================================================================
-- 06_browser_activity_logs_rls_fix.sql
-- Purpose: Close the cross-admin data leak on browser_activity_logs by scoping
--          SELECT to (a) an admin's own connected employees, and
--          (b) an employee viewing their own rows.
-- IDEMPOTENT: safe to re-run — uses DROP ... IF EXISTS / OR REPLACE guards.
-- Run AFTER 04_browser_activity_logs.sql and 02_users.sql.
-- =============================================================================

-- Cast-safe helper: employee_id is TEXT and may hold non-UUID test/device IDs
-- (e.g. 'TEST-EMP-001'). A raw ::uuid cast on those rows would raise an error
-- and abort the whole query, so we swallow the cast failure and return NULL,
-- which simply excludes that row from a uuid-based match instead of erroring.
CREATE OR REPLACE FUNCTION safe_employee_uuid(val text)
RETURNS uuid AS $$
BEGIN
  RETURN val::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP POLICY IF EXISTS "authenticated_select_browser_activity" ON browser_activity_logs;
DROP POLICY IF EXISTS "scoped_select_browser_activity" ON browser_activity_logs;

-- Admins see rows for employees connected to them; employees see their own rows.
CREATE POLICY "scoped_select_browser_activity"
ON browser_activity_logs FOR SELECT TO authenticated
USING (
  safe_employee_uuid(employee_id) IN (
    SELECT id FROM users WHERE admin_id = auth.uid()
  )
  OR safe_employee_uuid(employee_id) = auth.uid()
);

-- =============================================================================
-- PART 1: ADD MULTI-TENANT LINKING (connection_requests and users.admin_id)
-- =============================================================================

-- 1a. Add admin_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES users(id);

-- 1b. Create connection_requests table
CREATE TABLE IF NOT EXISTS connection_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        uuid NOT NULL REFERENCES users(id),
    employee_email  text NOT NULL,
    code            text NOT NULL,
    status          text NOT NULL DEFAULT 'pending',
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 1c. Enable RLS and create policies for connection_requests
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_insert_own_requests" ON connection_requests;
CREATE POLICY "admins_insert_own_requests"
ON connection_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() = admin_id);

DROP POLICY IF EXISTS "admins_select_own_requests" ON connection_requests;
CREATE POLICY "admins_select_own_requests"
ON connection_requests FOR SELECT TO authenticated
USING (auth.uid() = admin_id);

DROP POLICY IF EXISTS "employees_select_own_email_requests" ON connection_requests;
CREATE POLICY "employees_select_own_email_requests"
ON connection_requests FOR SELECT TO authenticated
USING (employee_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "employees_update_own_email_requests" ON connection_requests;
CREATE POLICY "employees_update_own_email_requests"
ON connection_requests FOR UPDATE TO authenticated
USING (employee_email = auth.jwt() ->> 'email')
WITH CHECK (employee_email = auth.jwt() ->> 'email');

-- 1d. Update existing RLS on employee_activity_logs and users

-- For employee_activity_logs
DROP POLICY IF EXISTS "users_select_own" ON employee_activity_logs;
CREATE POLICY "users_select_own"
ON employee_activity_logs FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR user_id IN (SELECT id FROM users WHERE admin_id = auth.uid())
);

DROP POLICY IF EXISTS "users_delete_own" ON employee_activity_logs;
CREATE POLICY "users_delete_own"
ON employee_activity_logs FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR user_id IN (SELECT id FROM users WHERE admin_id = auth.uid())
);

-- For users table
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own"
ON users FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR admin_id = auth.uid()
);

DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own"
ON users FOR UPDATE TO authenticated
USING (auth.uid() = id OR admin_id = auth.uid())
WITH CHECK (auth.uid() = id OR admin_id = auth.uid());

DROP POLICY IF EXISTS "users_delete_own" ON users;
CREATE POLICY "users_delete_own"
ON users FOR DELETE TO authenticated
USING (auth.uid() = id OR admin_id = auth.uid());
