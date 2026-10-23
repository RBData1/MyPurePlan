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
          const { parseCredentials, testQuickFileConnection, createQuickFileInvoice } = await import(
            './api/_lib/quickfileCore.ts'
          );
          const creds = parseCredentials(body, process.env.QUICKFILE_APPLICATION_ID);
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
              line: {
                service: String(body.line?.service || 'Service'),
                description: body.line?.description,
                price: Number(body.line?.price || 0),
                date: String(body.line?.date || new Date().toISOString().slice(0, 10)),
              },
              vatMode,
              termDays: Number(body.termDays) || 14,
            });
            sendJson(res, 200, result);
            return;
          }
          sendJson(res, 404, { error: 'Not found' });
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : 'QuickFile request failed' });
        }
      });
    },
  };
}
