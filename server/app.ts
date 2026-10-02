import express from 'express';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { runChecks } from '../src/pki';
import { parseTicket, triage } from './triage';

export function createApp(client?: TypeSafeClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && origin !== `http://${req.get('host')}` && origin !== `https://${req.get('host')}`) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));

  app.get('/api/config', (_req, res) => {
    res.json({ live: !!client, model: process.env.TYPESAFE_MODEL?.trim() || 'jev-latest' });
  });

  // Simple global limiter: this is a demo server, not a multi-tenant service.
  let windowStart = Date.now(); let calls = 0; let active = 0;
  app.post('/api/triage', async (req, res) => {
    if (!client) { res.status(503).json({ error: 'Live Jev is not configured on this server. Set TYPESAFE_API_KEY and restart.' }); return; }
    let ticket;
    try { ticket = parseTicket(req.body?.ticket); } catch { res.status(400).json({ error: 'Invalid ticket: subject and body are required.' }); return; }
    if (Date.now() - windowStart >= 60_000) { calls = 0; windowStart = Date.now(); }
    if (calls >= 30 || active >= 3) { res.status(429).json({ error: 'Too many triage requests. Wait a moment and retry.' }); return; }
    calls++; active++;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try { res.json(await triage(client, ticket, runChecks(), controller.signal)); }
    catch { if (!res.destroyed) res.status(502).json({ error: 'Jev triage failed. Check the server API key and connection, then retry.' }); }
    finally { active--; }
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API endpoint.' }); });
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error) return next();
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request body.' });
  });
  return app;
}
