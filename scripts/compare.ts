// Jev vs the LLM baseline on the same tickets, same pipeline, same policy.
import { readFileSync } from 'node:fs';
import { costUSD, grade, route, runChecks, tickets, type Triage } from '../src/pki';

const jev = JSON.parse(readFileSync('data/recorded.json', 'utf8'));
const base = JSON.parse(readFileSync('data/baseline.json', 'utf8'));
const findings = runChecks();
const ids: string[] = base.tickets;
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function summarise(name: string, results: Record<string, Triage>) {
  const rows = ids.map(id => {
    const t = tickets.find(x => x.id === id)!;
    const r = results[id]; const d = route(r, findings); const g = grade(t, r, d)!;
    return { t, r, d, g };
  });
  const causeRows = rows.filter(r => r.g.causeCorrect !== null);
  return {
    name,
    model: rows[0].r.model,
    handled: rows.filter(r => r.d.kind === 'auto' || r.d.kind === 'route_out').length,
    wrong: rows.filter(r => r.g.wrongAuto).length,
    cause: `${causeRows.filter(r => r.g.causeCorrect).length} of ${causeRows.length}`,
    medianMs: median(rows.map(r => r.r.latencyMs)),
    input: rows.reduce((n, r) => n + r.r.usage.input_tokens, 0),
    output: rows.reduce((n, r) => n + r.r.usage.output_tokens, 0),
    cost: rows.reduce((n, r) => n + (costUSD(r.r.model, r.r.usage) ?? 0), 0),
    rows,
  };
}

const runs = [summarise('Jev', jev.results), ...Object.values(base.runs).map((r: any) => summarise('LLM baseline', r.results))];
console.log(`Same ${ids.length} tickets, same lookup code, same routing policy.\n`);
for (const r of runs) {
  console.log(`${r.name} (${r.model})`);
  console.log(`  routed without a human ${r.handled}/${ids.length} | wrong automatic actions ${r.wrong} | cause correct ${r.cause}`);
  console.log(`  median ${r.medianMs} ms | tokens ${r.input} in / ${r.output} out | cost $${r.cost.toFixed(6)} | per 1,000 tickets $${(r.cost / ids.length * 1000).toFixed(2)}`);
}
const [a, b] = runs;
console.log(`\nRatios: cost x${(b.cost / a.cost).toFixed(1)} | median latency x${(b.medianMs / a.medianMs).toFixed(1)}`);
console.log('\nPer ticket:');
for (const id of ids) {
  const cells = runs.map(r => { const row = r.rows.find(x => x.t.id === id)!; return `${r.name}: ${row.r.cause.choice}/${row.d.kind}${row.g.wrongAuto ? ' WRONG' : ''}`; });
  console.log(`  ${id.padEnd(8)} label ${String(tickets.find(t => t.id === id)!.label?.cause).padEnd(20)} ${cells.join(' | ')}`);
}
