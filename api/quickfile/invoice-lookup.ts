import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findQuickFileInvoiceByNumber, parseCredentials } from '../_lib/quickfileCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    const creds = parseCredentials(body, process.env.QUICKFILE_APPLICATION_ID);
    const invoiceNumber = String(body.invoiceNumber || '').trim();
    if (!invoiceNumber) {
      res.status(400).json({ error: 'Enter the QuickFile invoice number.' });
      return;
    }
    const invoice = await findQuickFileInvoiceByNumber(creds, invoiceNumber);
    res.status(200).json({ invoice });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not find that QuickFile invoice' });
  }
}
