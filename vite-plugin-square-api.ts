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

/** Local Vite middleware so /api/square/* works during npm run dev. */
export function squareApiPlugin(): Plugin {
  return {
    name: 'square-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/square/')) return next();
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readJson(req);
          const { parseSquareCredentials, testSquareConnection, fetchSquareCalendar, upsertSquareVisit, cancelSquareVisit } = await import('./api/_lib/squareCore.ts');
          const creds = parseSquareCredentials(body);
          if (url.startsWith('/api/square/test')) {
            sendJson(res, 200, await testSquareConnection(creds));
            return;
          }
          if (url.startsWith('/api/square/bookings')) {
            sendJson(res, 200, await fetchSquareCalendar(creds));
            return;
          }
          if (url.startsWith('/api/square/push')) {
            sendJson(res, 200, await upsertSquareVisit(creds, body));
            return;
          }
          if (url.startsWith('/api/square/cancel')) {
            sendJson(res, 200, await cancelSquareVisit(creds, String(body?.bookingId || '')));
            return;
          }
          sendJson(res, 404, { error: 'Not found' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Square request failed';
          console.error('[square]', url, message);
          sendJson(res, 400, { error: message });
        }
      });
    },
  };
}
