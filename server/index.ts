import { resolve } from 'node:path';
import express from 'express';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { createApp } from './app';

const client = process.env.TYPESAFE_API_KEY?.trim()
  ? new TypeSafeClient({ defaultModel: process.env.TYPESAFE_MODEL?.trim() || 'jev-latest', logLevel: 'off' })
  : undefined;

const app = createApp(client);
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || '127.0.0.1';
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get(/.*/, (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, host, () => console.log(`CertRadar → http://localhost:${port} (${client ? 'live Jev enabled' : 'recorded mode only'})`));
