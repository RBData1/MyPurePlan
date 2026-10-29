import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/** QuickFile posts payment events here. The SQL function checks the signature. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, endpoint: 'quickfile-webhook' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase is not configured for the webhook.' });
    return;
  }
  const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('apply_quickfile_webhook', { payload });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const result = (data || {}) as { ok?: boolean; error?: string; duplicate?: boolean };
  if (!result.ok) {
    res.status(401).json({ error: result.error || 'Webhook rejected' });
    return;
  }
  res.status(200).json({ ok: true, duplicate: Boolean(result.duplicate) });
}
