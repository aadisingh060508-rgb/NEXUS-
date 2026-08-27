import { createClient } from '@supabase/supabase-js'

const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const envAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

// Fallback to localStorage if configured via in-app settings
const storedUrl = typeof window !== 'undefined' ? (localStorage.getItem('supabase_url') || '').trim() : ''
const storedKey = typeof window !== 'undefined' ? (localStorage.getItem('supabase_anon_key') || '').trim() : ''

export const supabaseUrl = envUrl || storedUrl || ''
export const supabaseAnonKey = envAnonKey || storedKey || ''

export const isSupabaseConfigured = () => {
  const url = (import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || '').trim()
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || '').trim()
  return Boolean(url && key)
}

let _cachedClient = null
let _cachedUrl = ''
let _cachedKey = ''

export const getSupabaseClient = () => {
  const url = (import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || '').trim()
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || '').trim()
  
  if (!url || !key) {
    return null
  }

  // Return cached client if URL/key haven't changed (preserves auth session)
  if (_cachedClient && _cachedUrl === url && _cachedKey === key) {
    return _cachedClient
  }

  _cachedClient = createClient(url, key)
  _cachedUrl = url
  _cachedKey = key
  return _cachedClient
}

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null
