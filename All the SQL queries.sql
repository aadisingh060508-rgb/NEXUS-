-- =============================================================================
-- ALL SQL QUERIES (Supabase Master Schema & Policies)
-- Project: ITR Project (Browser & File System Monitoring)
-- =============================================================================

-- =============================================================================
-- 1. Helper Functions
-- =============================================================================

-- Cast-safe helper: employee_id is TEXT and may hold non-UUID IDs (e.g. 'TEST-EMP-001').
-- Returns NULL on invalid text instead of throwing an unhandled exception.
CREATE OR REPLACE FUNCTION safe_employee_uuid(val text)
RETURNS uuid AS $$
BEGIN
  RETURN val::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- RPC Function for clearing activity logs
CREATE OR REPLACE FUNCTION delete_all_activity_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.employee_activity_logs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 2. users (Employee & Admin Profile Details)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id                        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Personal details
    full_name                 text NOT NULL,
    email                     text UNIQUE NOT NULL,
    phone                     text,

    -- Employment / Multi-tenant details
    role                      text NOT NULL DEFAULT 'employee', -- 'employee', 'admin', 'manager'
    department                text,
    hire_date                 date,
    admin_id                  uuid REFERENCES public.users(id),

    -- Account status
    is_active                 boolean NOT NULL DEFAULT true,
    onboarded                 boolean NOT NULL DEFAULT false,

    -- Timestamps
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users may insert their own row
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
CREATE POLICY "users_insert_own"
ON public.users FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

-- Users see their own row OR admins see their connected employees
DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own"
ON public.users FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR admin_id = auth.uid()
);

-- Users can update their own row (e.g. to link admin_id) OR admins can update employees
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own"
ON public.users FOR UPDATE TO authenticated
USING (auth.uid() = id OR admin_id = auth.uid())
WITH CHECK (auth.uid() = id OR admin_id = auth.uid());

-- Users / Admins can delete
DROP POLICY IF EXISTS "users_delete_own" ON public.users;
CREATE POLICY "users_delete_own"
ON public.users FOR DELETE TO authenticated
USING (auth.uid() = id OR admin_id = auth.uid());


-- =============================================================================
-- 3. Trigger: Automatically Sync auth.users to public.users on Sign Up
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, is_active)
  VALUES (
    new.id, 
    new.email, 
    SPLIT_PART(new.email, '@', 1), 
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- 4. connection_requests (Admin-to-Employee pairing via 6-digit code)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.connection_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        uuid NOT NULL REFERENCES public.users(id),
    employee_email  text NOT NULL,
    code            text NOT NULL,
    status          text NOT NULL DEFAULT 'pending',
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_insert_own_requests" ON public.connection_requests;
CREATE POLICY "admins_insert_own_requests"
ON public.connection_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() = admin_id);

DROP POLICY IF EXISTS "admins_select_own_requests" ON public.connection_requests;
CREATE POLICY "admins_select_own_requests"
ON public.connection_requests FOR SELECT TO authenticated
USING (auth.uid() = admin_id);

DROP POLICY IF EXISTS "employees_select_own_email_requests" ON public.connection_requests;
CREATE POLICY "employees_select_own_email_requests"
ON public.connection_requests FOR SELECT TO authenticated
USING (employee_email = (auth.jwt() ->> 'email'::text));

DROP POLICY IF EXISTS "employees_update_own_email_requests" ON public.connection_requests;
CREATE POLICY "employees_update_own_email_requests"
ON public.connection_requests FOR UPDATE TO authenticated
USING (employee_email = (auth.jwt() ->> 'email'::text))
WITH CHECK (employee_email = (auth.jwt() ->> 'email'::text));


-- =============================================================================
-- 5. employee_activity_logs (File system / USB Hardware Events)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.employee_activity_logs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action                    text NOT NULL,
    details                   jsonb NOT NULL DEFAULT '{}',
    device_id                 text,
    pen_drive_id              text,
    source_path               text,
    dest_path                 text,
    admin_notified            boolean NOT NULL DEFAULT false,
    timestamp                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_insert_own" ON public.employee_activity_logs;
CREATE POLICY "users_insert_own"
ON public.employee_activity_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_select_own" ON public.employee_activity_logs;
CREATE POLICY "users_select_own"
ON public.employee_activity_logs FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR user_id IN (SELECT id FROM public.users WHERE admin_id = auth.uid())
);

DROP POLICY IF EXISTS "users_delete_own" ON public.employee_activity_logs;
CREATE POLICY "users_delete_own"
ON public.employee_activity_logs FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR user_id IN (SELECT id FROM public.users WHERE admin_id = auth.uid())
);


-- =============================================================================
-- 6. browser_activity_logs (Web browsing activity from Chrome extension)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.browser_activity_logs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id               text NOT NULL,
    url                       text NOT NULL,
    domain                    text,
    page_title                text,
    visited_at                timestamptz NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.browser_activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow local employee-agent backend to insert browsing events
DROP POLICY IF EXISTS "allow_insert_browser_activity" ON public.browser_activity_logs;
CREATE POLICY "allow_insert_browser_activity"
ON public.browser_activity_logs FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- Allow admins to see browser logs for their connected employees, or employees to see their own
DROP POLICY IF EXISTS "scoped_select_browser_activity" ON public.browser_activity_logs;
CREATE POLICY "scoped_select_browser_activity"
ON public.browser_activity_logs FOR SELECT TO authenticated
USING (
  safe_employee_uuid(employee_id) IN (
    SELECT id FROM public.users WHERE admin_id = auth.uid()
  )
  OR safe_employee_uuid(employee_id) = auth.uid()
);
