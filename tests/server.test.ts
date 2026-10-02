import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { createApp } from '../server/app';
import { triage } from '../server/triage';
import { runChecks, tickets } from '../src/pki';

const servers: Server[] = [];
async function start(client?: TypeSafeClient) {
  const server = createApp(client).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); }))); });

const post = (url: string, body: unknown) => fetch(`${url}/api/triage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ticket = { subject: 'Cert warning', body: 'shop.acme-retail.test shows an expired certificate on some requests.' };

/** Fake TypeSafe API: answers every question with a fixed, valid shape. */
function fakeApi(calls: { questions: string[]; state?: unknown }[]) {
  return async (_url: string, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    calls.push({ questions: Object.keys(req.questions), state: req.state });
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries<{ type: string; criteria: Record<string, unknown> | unknown[] }>(req.questions)) {
      if (q.type === 'noul') answers[id] = { type: 'noul', noul: id === 'link_0' ? 0.9 : 0.1 };
      if (q.type === 'choice') {
        const labels = Object.keys(q.criteria);
        const pick = labels.includes('deployment_mismatch') ? 'deployment_mismatch' : 'shop';
        answers[id] = { type: 'choice', choice: pick, confidence: 0.9, probabilities: Object.fromEntries(labels.map(l => [l, l === pick ? 0.9 : 0.1 / (labels.length - 1)])) };
      }
      if (q.type === 'score') answers[id] = { type: 'score', score: 2, confidence: 0.8, legend: {}, probabilities: { 0: 0, 1: 0.1, 2: 0.8, 3: 0.1 } };
    }
    return new Response(JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 10, output_tokens: 2 } }), { headers: { 'Content-Type': 'application/json' } });
  };
}

describe('triage API', () => {
  it('reports live availability and refuses unconfigured live calls', async () => {
    const url = await start();
    expect(await (await fetch(`${url}/api/config`)).json()).toMatchObject({ live: false });
    expect((await post(url, { ticket })).status).toBe(503);
  });
  it('rejects cross-origin calls and malformed tickets before calling Jev', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) }));
    expect((await fetch(`${url}/api/triage`, { method: 'POST', headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await post(url, { ticket: { subject: '', body: 'x' } })).status).toBe(400);
    expect((await post(url, { ticket: { subject: 'x', body: 'y'.repeat(2001) } })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('asks symptom and evidence questions in two parallel requests', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) }));
    const res = await post(url, { ticket });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cause.choice).toBe('deployment_mismatch');
    expect(body.links['stale:edge-02']).toBe(0.9);
    expect(body.usage).toEqual({ input_tokens: 20, output_tokens: 4 });
    expect(calls.find(c => c.questions.includes('cause'))!.questions).toEqual(['cause', 'urgency', 'service']);
    // Only the matched certificates reach Jev, never the whole inventory.
    const evidence = calls.find(c => c.questions.includes('link_0'))!.state as { certificates: unknown[] };
    expect(evidence.certificates).toHaveLength(2);
    expect(JSON.stringify(calls.find(c => c.questions.includes('cause'))!.state)).not.toContain('certificates');
  });
  it('returns a sanitized error when Jev fails', async () => {
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', retry: { maxRetries: 0 }, fetch: async () => { throw new Error('upstream secret'); } }));
    const res = await post(url, { ticket });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('upstream secret');
  });
  it('returns both raw exchanges and never forwards fields other than the ticket text', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) }));
    const res = await post(url, { ticket: { ...ticket, label: { cause: 'expired' }, secret: 'x' } });
    const body = await res.json();
    expect(body.calls.map((c: { name: string }) => c.name)).toEqual(['symptoms', 'evidence']);
    expect(body.calls[0].request).toMatchObject({ model: 'jev-latest', questions: { cause: { type: 'choice' } } });
    expect(body.calls[0].response.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
    for (const c of calls) expect(Object.keys((c.state as { ticket: object }).ticket).sort()).toEqual(['body', 'reporter', 'subject']);
  });
  it('strips evaluation labels when sample tickets are triaged directly', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const client = new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) });
    await triage(client, tickets[0], runChecks());
    expect(JSON.stringify(calls.map(c => c.state))).not.toMatch(/label|T-101/);
  });
  it('accepts intake details, validates the CN, and looks the CN up in code', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) }));
    expect((await post(url, { ticket: { ...ticket, details: { cn: 'bad name; rm -rf' } } })).status).toBe(400);
    const res = await post(url, { ticket: { subject: 'Cert error', body: 'The site shows a warning.', details: { cn: 'www.acme-retail.test', error: 'NET::ERR_CERT_COMMON_NAME_INVALID' } } });
    const body = await res.json();
    expect(body.identification).toMatchObject({ source: 'form', certs: ['c-www'] });
    expect(body.links).toHaveProperty(['name:edge-04']);
  });
  it('asks Jev for the service first when the ticket names no host, then only sends that service', async () => {
    const calls: { questions: string[]; state?: unknown }[] = [];
    const url = await start(new TypeSafeClient({ apiKey: 'test', logLevel: 'off', fetch: fakeApi(calls) }));
    const res = await post(url, { ticket: { subject: 'Customers see warnings', body: 'Some customers see a certificate warning on the storefront.' } });
    const body = await res.json();
    expect(body.identification).toMatchObject({ source: 'service', service: 'shop', matched: 2 });
    expect(body.calls.map((c: { name: string }) => c.name)).toEqual(['symptoms', 'evidence']);
    expect(body.calls[1].startedAtMs).toBeGreaterThanOrEqual(body.calls[0].latencyMs);
  });
});
