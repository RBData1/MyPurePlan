import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchQuickFileInvoicePayments, parseCredentials } from '../_lib/quickfileCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    const creds = parseCredentials(body, process.env.QUICKFILE_APPLICATION_ID);
    const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.map((id: unknown) => Number(id)) : [];
    if (!invoiceIds.some((id: number) => Number.isFinite(id) && id > 0)) {
      res.status(400).json({ error: 'Choose at least one QuickFile invoice to check.' });
      return;
    }
    const invoices = await fetchQuickFileInvoicePayments(creds, invoiceIds);
    res.status(200).json({ invoices });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not check QuickFile invoices' });
  }
}
