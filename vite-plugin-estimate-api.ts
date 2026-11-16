import { loadEnv, type Plugin } from 'vite';
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

/** Local Vite middleware so /api/estimate-windows works during npm run dev. */
export function estimateApiPlugin(): Plugin {
  return {
    name: 'estimate-api-dev',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/estimate-windows')) return next();
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readJson(req);
          const { estimateWindows } = await import('./api/_lib/geminiEstimate.ts');
          const quote = await estimateWindows(body, env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '');
          sendJson(res, 200, { quote });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not estimate the windows.';
          const status = /GEMINI_API_KEY|photo|address|large|JSON/.test(message) ? 400 : 502;
          sendJson(res, status, { error: message });
        }
      });
    },
  };
}
