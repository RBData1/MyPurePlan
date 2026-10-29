import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Local Vite middleware so /api/quickfile/* works during npm run dev. */
export function quickfileApiPlugin(): Plugin {
  return {
    name: 'quickfile-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/quickfile/')) return next();
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readJson(req);
          if (url.startsWith('/api/quickfile/webhook')) {
            const { createClient } = await import('@supabase/supabase-js');
            const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
            const supabaseKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
            if (!supabaseUrl || !supabaseKey) {
              sendJson(res, 500, { error: 'Supabase is not configured for the webhook.' });
              return;
            }
            const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
            const { data, error } = await client.rpc('apply_quickfile_webhook', { payload: body });
            if (error) {
              sendJson(res, 500, { error: error.message });
              return;
            }
            const result = (data || {}) as { ok?: boolean; error?: string };
            if (!result.ok) {
              sendJson(res, 401, { error: result.error || 'Webhook rejected' });
              return;
            }
            sendJson(res, 200, { ok: true });
            return;
          }
          const { parseCredentials, testQuickFileConnection, createQuickFileInvoice, fetchQuickFileInvoicePayments } = await import(
            './api/_lib/quickfileCore.ts'
          );
          const creds = parseCredentials(body, process.env.QUICKFILE_APPLICATION_ID);
          if (url.startsWith('/api/quickfile/invoice-status')) {
            const invoiceIds = Array.isArray(body?.invoiceIds) ? body.invoiceIds.map((id: unknown) => Number(id)) : [];
            if (!invoiceIds.some((id: number) => Number.isFinite(id) && id > 0)) {
              sendJson(res, 400, { error: 'Choose at least one QuickFile invoice to check.' });
              return;
            }
            const invoices = await fetchQuickFileInvoicePayments(creds, invoiceIds);
            sendJson(res, 200, { invoices });
            return;
          }
          if (url.startsWith('/api/quickfile/test')) {
            const result = await testQuickFileConnection(creds);
            sendJson(res, 200, result);
            return;
          }
          if (url.startsWith('/api/quickfile/create-invoice')) {
            if (!String(body?.client?.name || '').trim()) {
              sendJson(res, 400, { error: 'Customer name is required to create a QuickFile invoice.' });
              return;
            }
            const vatMode = ['exempt', 'standard20_gross', 'standard20_net'].includes(body.vatMode)
              ? body.vatMode
              : 'exempt';
            const rawLines = Array.isArray(body.lines) && body.lines.length ? body.lines : [body.line || {}];
            const result = await createQuickFileInvoice(creds, {
              client: {
                name: String(body.client.name).trim(),
                email: body.client.email,
                phone: body.client.phone,
                phone2: body.client.phone2,
                address: body.client.address,
                town: body.client.town,
                postcode: body.client.postcode,
                quickfileClientId: body.client.quickfileClientId ?? null,
              },
              lines: rawLines.map((line: { service?: string; description?: string; price?: number; date?: string }) => ({
                service: String(line?.service || 'Service'),
                description: line?.description,
                price: Number(line?.price || 0),
                date: String(line?.date || new Date().toISOString().slice(0, 10)),
              })),
              vatMode,
              termDays: Number(body.termDays) || 14,
            });
            sendJson(res, 200, result);
            return;
          }
          sendJson(res, 404, { error: 'Not found' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'QuickFile request failed';
          console.error('[quickfile]', url, message);
          sendJson(res, 400, { error: message });
        }
      });
    },
  };
}
