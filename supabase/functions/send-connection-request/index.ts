// @ts-nocheck
// Supabase Edge Function – runs in the Deno runtime.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { employeeEmail } = await req.json()

    if (!employeeEmail) {
      return new Response(JSON.stringify({ error: 'employeeEmail is required' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const authHeader = req.headers.get('Authorization')
    const token = authHeader ? authHeader.replace('Bearer ', '') : ''
    const authUserResponse = await supabaseClient.auth.getUser(token)
    const authUserId = authUserResponse.data?.user?.id

    if (!authUserId) {
      return new Response(JSON.stringify({
        error: 'Unauthorized: invalid or missing token',
        details: authUserResponse.error || 'No user ID found',
        debug: { authHeader: req.headers.get('Authorization') }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminId = authUserId

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const normalizedEmail = employeeEmail.trim().toLowerCase()

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .single()

    if (targetError || !targetUser) {
      return new Response(JSON.stringify({
        error: "no_account",
        message: "No account found for this email. Ask them to sign up first."
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Generate a 6-digit code valid for 30 minutes
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString()

    // Ensure admin user profile exists in public.users to prevent FK error
    await supabaseAdmin.from('users').upsert({
      id: adminId,
      email: authUserResponse.data?.user?.email || 'admin@itr.local',
      full_name: authUserResponse.data?.user?.email?.split('@')[0] || 'Admin',
      role: 'admin',
      is_active: true
    }, { onConflict: 'id' })

    const { error: insertError } = await supabaseAdmin
      .from('connection_requests')
      .insert({
        admin_id: adminId,
        employee_email: normalizedEmail,
        code: code,
        status: 'pending',
        expires_at: expiresAt
      })

    if (insertError) throw insertError

    // Return code + adminId directly — admin shows it on screen, no email needed
    return new Response(JSON.stringify({
      success: true,
      adminId: adminId,
      code: code,
      expiresInMinutes: 30
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    const error = err as Error
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
