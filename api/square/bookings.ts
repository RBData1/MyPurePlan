import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchSquareCalendar, parseSquareCredentials } from '../_lib/squareCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const result = await fetchSquareCalendar(parseSquareCredentials(req.body || {}));
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not load Square appointments' });
  }
}
