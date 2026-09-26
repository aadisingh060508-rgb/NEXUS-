-- =============================================================================
-- 08_agent_commands.sql
-- Purpose: Cloud-relay control channel between the admin dashboard and
--          employee agents running on remote machines.
--          Instead of LAN-direct /api/toggle calls, the admin writes a command
--          row here; the employee-agent subscribes via Supabase Realtime and
--          executes it locally, then updates status = 'done'.
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_commands (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command      text        NOT NULL,          -- 'toggle_tracking' | 'watch' | 'unwatch' | 'get_status'
    payload      jsonb       NOT NULL DEFAULT '{}',
    status       text        NOT NULL DEFAULT 'pending', -- 'pending' | 'done' | 'error'
    result       jsonb,                          -- agent writes back here (e.g. { tracking: true })
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Auto-update updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_agent_commands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_commands_updated_at ON agent_commands;
CREATE TRIGGER agent_commands_updated_at
  BEFORE UPDATE ON agent_commands
  FOR EACH ROW EXECUTE FUNCTION set_agent_commands_updated_at();

-- ── 3. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE agent_commands ENABLE ROW LEVEL SECURITY;

-- Admin: can insert commands for their own employees
DROP POLICY IF EXISTS "admins_insert_commands" ON agent_commands;
CREATE POLICY "admins_insert_commands"
ON agent_commands FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() = admin_id
    AND employee_id IN (SELECT id FROM users WHERE admin_id = auth.uid())
);

-- Admin: can read commands they sent
DROP POLICY IF EXISTS "admins_select_own_commands" ON agent_commands;
CREATE POLICY "admins_select_own_commands"
ON agent_commands FOR SELECT TO authenticated
USING (auth.uid() = admin_id);

-- Employee agent: can read commands addressed to them
DROP POLICY IF EXISTS "employees_select_own_commands" ON agent_commands;
CREATE POLICY "employees_select_own_commands"
ON agent_commands FOR SELECT TO authenticated
USING (auth.uid() = employee_id);

-- Employee agent: can update status/result on their own commands
DROP POLICY IF EXISTS "employees_update_own_commands" ON agent_commands;
CREATE POLICY "employees_update_own_commands"
ON agent_commands FOR UPDATE TO authenticated
USING (auth.uid() = employee_id)
WITH CHECK (auth.uid() = employee_id);

-- ── 4. Realtime publication ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'agent_commands'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_commands;
  END IF;
END $$;

-- ── 5. Cleanup helper: auto-delete commands older than 24 h ──────────────────
CREATE OR REPLACE FUNCTION cleanup_old_agent_commands()
RETURNS void AS $$
BEGIN
  DELETE FROM agent_commands
  WHERE created_at < now() - INTERVAL '24 hours'
    AND status IN ('done', 'error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
