// Runs every sample ticket through live Jev and saves the answers, so the
// published demo can replay real model output without an API key.
import { writeFileSync } from 'node:fs';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { runChecks, tickets, type Triage } from '../src/pki';
import { triage } from '../server/triage';

if (!process.env.TYPESAFE_API_KEY) { console.error('Set TYPESAFE_API_KEY in .env first.'); process.exit(1); }
const client = new TypeSafeClient({ defaultModel: process.env.TYPESAFE_MODEL?.trim() || 'jev-latest', logLevel: 'off' });
const findings = runChecks();
const results: Record<string, Triage> = {};
for (const ticket of tickets) {
  results[ticket.id] = await triage(client, ticket, findings);
  const r = results[ticket.id];
  console.log(`${ticket.id.padEnd(8)} ${r.cause.choice.padEnd(20)} conf ${r.cause.confidence.toFixed(2)}  service ${r.service.choice}:${r.service.confidence.toFixed(2)}  lookup ${r.identification.source}/${r.identification.matched}  ${r.usage.input_tokens} tok  ${r.latencyMs} ms`);
}
const model = Object.values(results)[0]?.model ?? 'unknown';
writeFileSync('data/recorded.json', JSON.stringify({ model, recordedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`Saved data/recorded.json (${model}).`);
