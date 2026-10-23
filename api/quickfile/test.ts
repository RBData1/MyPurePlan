import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseCredentials, testQuickFileConnection } from '../_lib/quickfileCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const creds = parseCredentials(req.body || {}, process.env.QUICKFILE_APPLICATION_ID);
    const result = await testQuickFileConnection(creds);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'QuickFile test failed' });
  }
}
