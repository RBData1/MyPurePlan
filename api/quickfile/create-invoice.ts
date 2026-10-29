import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createQuickFileInvoice,
  parseCredentials,
  type QuickFileVatMode,
} from '../_lib/quickfileCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    if (!String(body.client?.name || '').trim()) {
      res.status(400).json({ error: 'Customer name is required to create a QuickFile invoice.' });
      return;
    }
    const creds = parseCredentials(body, process.env.QUICKFILE_APPLICATION_ID);
    const vatMode = (['exempt', 'standard20_gross', 'standard20_net'].includes(body.vatMode)
      ? body.vatMode
      : 'exempt') as QuickFileVatMode;
    const rawLines = Array.isArray(body.lines) && body.lines.length ? body.lines : [body.line || {}];
    const result = await createQuickFileInvoice(creds, {
      client: {
        name: String(body.client.name).trim(),
        email: body.client?.email,
        phone: body.client?.phone,
        phone2: body.client?.phone2,
        address: body.client?.address,
        town: body.client?.town,
        postcode: body.client?.postcode,
        quickfileClientId: body.client?.quickfileClientId ?? null,
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
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create QuickFile invoice' });
  }
}
