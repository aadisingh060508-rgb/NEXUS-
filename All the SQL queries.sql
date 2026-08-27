-- =============================================================================
-- ALL SQL QUERIES (Supabase Schema & Policies)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. employee_activity_logs (one row per file system / hardware event)
-- -----------------------------------------------------------------------------
CREATE TABLE employee_activity_logs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK to the built‑in Supabase auth.users table (the employee’s UUID)
    user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Human‑readable action (short enum‑like string)
    action                    text NOT NULL,                     -- e.g. "pen_drive_insert", "file_moved", "pen_drive_eject"

    -- Flexible metadata – one JSON object per row
    details                   jsonb NOT NULL DEFAULT '{}',        -- { file_path, pen_drive_serial, … }

    -- Optional hardware identifiers
    device_id                 text,                               -- laptop hardware ID or UUID
    pen_drive_id              text,                               -- optional reference to a pen‑drive registry

    -- Path information (can also live inside `details`; kept here for easy indexing)
    source_path               text,                               -- original file/folder path
    dest_path                 text,                               -- destination (e.g. mount point of the USB)

    -- Audit flag – used by the trigger / cron for a single admin alert
    admin_notified            boolean NOT NULL DEFAULT false,

    -- Timestamp of the event
    timestamp                 timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Row‑Level Security: employee_activity_logs
-- -----------------------------------------------------------------------------
ALTER TABLE employee_activity_logs ENABLE ROW LEVEL SECURITY;

-- Users may insert only rows they own (the JWT `sub` = user_id)
CREATE POLICY "users_insert_own"
ON employee_activity_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users may select only their own rows; admins (role = admin) see everything
CREATE POLICY "users_select_own"
ON employee_activity_logs FOR SELECT TO authenticated
USING (auth.uid() = user_id OR auth.role() = 'admin');

-- Users may delete only their own rows (e.g. when clearing their history)
CREATE POLICY "users_delete_own"
ON employee_activity_logs FOR DELETE TO authenticated
USING (auth.uid() = user_id OR auth.role() = 'admin');


-- -----------------------------------------------------------------------------
-- 2. users (Employee Profile Details)
-- -----------------------------------------------------------------------------
-- This table stores additional employee information linked to Supabase auth.users.
-- id references auth.users(id) ON DELETE CASCADE so profiles auto-clean when users are deleted.
-- RLS policies mirror the employee_activity_logs pattern: users can only access their own row,
-- admins (auth.role() = 'admin') can see everything.
CREATE TABLE users (
    id                        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Personal details
    full_name                 text NOT NULL,
    email                     text UNIQUE NOT NULL,
    phone                     text,

    -- Employment details
    role                      text NOT NULL DEFAULT 'employee', -- e.g. 'employee', 'manager', 'admin'
    department                text,
    hire_date                 date,

    -- Account status
    is_active                 boolean NOT NULL DEFAULT true,
    onboarded                 boolean NOT NULL DEFAULT false,

    -- Timestamps
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Row‑Level Security: users
-- -----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users may insert only their own row (the JWT `sub` = id)
CREATE POLICY "users_insert_own"
ON users FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

-- Users may select only their own row; admins (role = admin) see everything
CREATE POLICY "users_select_own"
ON users FOR SELECT TO authenticated
USING (auth.uid() = id OR auth.role() = 'admin');

-- Admins may update any user row
CREATE POLICY "users_update_own"
ON users FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id OR auth.role() = 'admin');

-- Admins may delete any user row
CREATE POLICY "users_delete_own"
ON users FOR DELETE TO authenticated
USING (auth.uid() = id OR auth.role() = 'admin');


-- updated the polices for RLS 
CREATE OR REPLACE FUNCTION delete_all_activity_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.employee_activity_logs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- updated the polices for RLS -- 
CREATE OR REPLACE FUNCTION delete_all_activity_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.employee_activity_logs WHERE true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

