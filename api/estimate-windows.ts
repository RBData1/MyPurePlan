import type { VercelRequest, VercelResponse } from '@vercel/node';
import { estimateWindows } from './_lib/geminiEstimate.js';

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const quote = await estimateWindows(req.body || {}, process.env.GEMINI_API_KEY || '');
    res.status(200).json({ quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not estimate the windows.';
    const status = /GEMINI_API_KEY|photo|address|large/.test(message) ? 400 : 502;
    res.status(status).json({ error: message });
  }
}
