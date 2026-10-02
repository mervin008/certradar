// Runs every sample ticket through an ordinary LLM with the same pipeline as Jev,
// so the LinkedIn comparison uses measured numbers instead of estimates.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { runChecks, tickets, type Triage } from '../src/pki';
import { baselineTriage } from '../server/baseline';

// Optional: --only T-101,T-102 to stay inside a free-tier daily quota.
const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1].split(',') : null;
const models = (onlyIdx >= 0 ? [...argv.slice(0, onlyIdx), ...argv.slice(onlyIdx + 2)] : argv);
if (!models.length) { console.error('Usage: npm run baseline -- gemini-3.6-flash [more models]'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY in .env first.'); process.exit(1); }

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const findings = runChecks();
type Run = { model: string; recordedAt: string; results: Record<string, Triage> };
// Merge with anything already measured, so a quota-limited run can be completed later.
const runs: Record<string, Run> = existsSync('data/baseline.json') ? JSON.parse(readFileSync('data/baseline.json', 'utf8')).runs ?? {} : {};
const save = () => writeFileSync('data/baseline.json', JSON.stringify({ runs, tickets: [...new Set(Object.values(runs).flatMap(r => Object.keys(r.results)))] }, null, 2) + '\n');

for (const model of models) {
  const results: Record<string, Triage> = runs[model]?.results ?? {};
  for (const ticket of tickets.filter(t => !only || only.includes(t.id))) {
    results[ticket.id] = await baselineTriage(genai, model, ticket, findings);
    runs[model] = { model, recordedAt: new Date().toISOString(), results };
    save(); // write as we go: a quota error must not throw away measured tickets
    await new Promise(r => setTimeout(r, 4500)); // stay under free-tier requests per minute
    const r = results[ticket.id];
    console.log(`${model}  ${ticket.id.padEnd(8)} ${r.cause.choice.padEnd(20)} conf ${r.cause.confidence.toFixed(2)}  service ${r.service.choice}:${r.service.confidence.toFixed(2)}  ${r.usage.input_tokens}+${r.usage.output_tokens} tok  ${r.latencyMs} ms`);
  }
  runs[model] = { model, recordedAt: new Date().toISOString(), results };
  save();
}
console.log(`Saved data/baseline.json (${models.join(', ')}).`);
