import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
const configured = Boolean(url && publicKey && !url.includes('YOUR_PROJECT') && !publicKey.includes('YOUR_SUPABASE'));

// Only the public/anon/publishable key belongs in a browser app. Never place a service-role key here.
export const supabase = configured ? createClient(url!, publicKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
export const isSupabaseConfigured = configured;
