/* -------------------------------------------------
   src/supabaseLog.js – helper for the existing
   employee_activity_logs table in Supabase.
   ------------------------------------------------- */

import { getSupabaseClient, supabase as defaultSupabase } from './supabaseClient'

/* -------------------------------------------------
   1️⃣ Cache the signed‑in user's UUID.
   ------------------------------------------------- */
let storedUserUuid = null

export function setStoredUserUuid(uuid) {
  storedUserUuid = uuid
}

export function getStoredUserUuid() {
  return storedUserUuid
}

export async function ensureUserUuid() {
  if (storedUserUuid) return storedUserUuid

  const client = getSupabaseClient() || defaultSupabase
  if (!client) {
    throw new Error('Supabase client is not configured')
  }

  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) {
    throw new Error(error?.message || 'User not signed in')
  }

  storedUserUuid = user.id // = auth.users(id)
  return storedUserUuid
}

/* -------------------------------------------------
   2️⃣ Insert one activity event into employee_activity_logs.
   ------------------------------------------------- */
export async function logActivity(ev) {
  await ensureUserUuid()

  const client = getSupabaseClient() || defaultSupabase
  if (!client) {
    throw new Error('Supabase client is not configured')
  }

  const action = ev.action || ev.type || 'unknown_action'
  const sourcePath = ev.source_path || ev.details?.source_path || ev.source || null
  const destPath = ev.dest_path || ev.details?.dest_path || ev.destination || ev.file || null

  const payload = {
    user_id: storedUserUuid, // FK to auth.users – required by RLS
    action: action,
    details: ev.details !== undefined ? ev.details : ev, // jsonb – client auto‑stringifies
    device_id: ev.device_id || null,
    pen_drive_id: ev.pen_drive_id || null,
    source_path: sourcePath,
    dest_path: destPath,
    admin_notified: false // default; will be toggled later by a trigger/cron
    // timestamp is omitted – Supabase sets DEFAULT now()
  }

  const { data, error } = await client
    .from('employee_activity_logs')
    .insert([payload])

  if (error) {
    console.error('❌ Supabase log insert failed', error)
    throw error
  } else {
    console.log('✅ Log saved –', action)
    return data
  }
}

/* -------------------------------------------------
   3️⃣ Fetch all activity logs for the current user.
   ------------------------------------------------- */
export async function fetchActivityLogs() {
  const client = getSupabaseClient() || defaultSupabase
  if (!client) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await client
    .from('employee_activity_logs')
    .select('*')
    .order('timestamp', { ascending: true })

  if (error) {
    console.error('❌ Supabase log fetch failed', error)
    throw error
  }
  return data || []
}

/* -------------------------------------------------
   4️⃣ Clear / delete activity logs for the user.
   ------------------------------------------------- */
export async function clearActivityLogs() {
  const client = getSupabaseClient() || defaultSupabase
  if (!client) {
    throw new Error('Supabase client is not configured')
  }

  console.log(`[Supabase] Deleting all activity logs via RPC call.`)

  // Call a Postgres function (RPC) to delete all rows.
  // This requires creating the function in the Supabase SQL editor first.
  const { data, error } = await client.rpc('delete_all_activity_logs')

  if (error) {
    console.error('❌ Supabase log clear failed:', error)
    throw error
  }

  console.log(`✅ Cleared activity logs via RPC`)
  return data
}

