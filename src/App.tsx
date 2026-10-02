import { useEffect, useMemo, useState, type ReactNode } from 'react';
import recorded from '../data/recorded.json';
import baseline from '../data/baseline.json';
import {
  MAX_CANDIDATES, NOW, PRICING_URL, caName, causeLabels, causes, certById, certs, costUSD, daysLeft, defaultPolicy, endpoints, grade, pricing, route, runChecks,
  serviceName, tickets as sampleTickets, urgencyLevels, validityText,
  type Details, type Finding, type JevCall, type Policy, type Route, type Ticket, type Triage,
} from './pki';

const findings = runChecks();
const recordedResults = recorded.results as unknown as Record<string, Triage>;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const int = (n: number) => n.toLocaleString('en-US');
const usd = (n: number | null) => n === null ? 'price not listed' : n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(2)}`;
const DAY = 86_400_000;

type Mode = 'recorded' | 'live';

export default function App() {
  const [live, setLive] = useState<{ available: boolean; model: string }>({ available: false, model: 'jev-latest' });
  const [mode, setMode] = useState<Mode>('recorded');
  const [liveResults, setLiveResults] = useState<Record<string, Triage>>({});
  const [custom, setCustom] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState('T-101');
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Live mode needs the local server; the hosted copy is a static recorded run.
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
    fetch('/api/config').then(r => r.ok ? r.json() : null)
      .then(c => c && setLive({ available: !!c.live, model: c.model }))
      .catch(() => { /* Static hosting: recorded mode only. */ });
  }, []);

  const allTickets = mode === 'live' ? [...custom, ...sampleTickets] : sampleTickets;
  const results = mode === 'recorded' ? recordedResults : liveResults;
  const ticket = allTickets.find(t => t.id === selected) ?? allTickets[0];
  const result = results[ticket.id];
  const decision = result ? route(result, findings, policy) : null;
  const linked = decision && 'finding' in decision && decision.finding ? decision.finding : null;

  async function triage(t: Ticket) {
    setError(null);
    setBusy(b => new Set(b).add(t.id));
    try {
      const res = await fetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: { subject: t.subject, body: t.body, reporter: t.reporter, details: t.details } }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Triage failed.');
      setLiveResults(r => ({ ...r, [t.id]: body }));
    } catch (e) {
      setError(`${t.id}: ${e instanceof Error ? e.message : 'Triage failed.'}`);
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(t.id); return n; });
    }
  }

  async function triageAll() {
    for (const t of allTickets) if (!liveResults[t.id]) await triage(t);
  }

  function addTicket(subject: string, body: string, details?: Details) {
    const t: Ticket = { id: `C-${custom.length + 1}`, subject, body, reporter: 'You', details };
    setCustom(c => [t, ...c]);
    setSelected(t.id);
    void triage(t);
  }

  /** The reporter answered CertRadar's questions: triage the same ticket again with the details. */
  function answer(t: Ticket, details: Details) {
    const next: Ticket = { ...t, id: `${t.id}-R`, subject: `${t.subject.replace(/ \(reporter answered the questions\)$/, '')} (reporter answered the questions)`, details, label: undefined };
    setCustom(c => [next, ...c.filter(x => x.id !== next.id)]);
    setSelected(next.id);
    void triage(next);
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <RadarMark />
          <div>
            <strong>CertRadar</strong>
            <span>Certificate incident triage for Acme Retail's PKI</span>
          </div>
        </div>
        <div className="mode" role="radiogroup" aria-label="Where Jev's answers come from">
          <button role="radio" aria-checked={mode === 'recorded'} className={mode === 'recorded' ? 'on' : ''} onClick={() => setMode('recorded')}>
            Recorded run <small>{recorded.model}, {new Date(recorded.recordedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
          </button>
          <button role="radio" aria-checked={mode === 'live'} className={mode === 'live' ? 'on' : ''} disabled={!live.available} onClick={() => setMode('live')}
            title={live.available ? undefined : 'This hosted page replays a recorded run. Clone the project and set TYPESAFE_API_KEY to call Jev live.'}>
            Live Jev <small>{live.available ? live.model : 'runs locally with a key'}</small>
          </button>
        </div>
      </header>

      <p className="intro">
        Pick a ticket to see how it was handled. Code finds which of the {certs.length} certificates the ticket is about, Jev reads the ticket and
        weighs only those few, and a fixed policy decides what happens next. When CertRadar cannot tell which certificate it is, it asks the reporter
        for the CN instead of guessing. Each Jev step shows exactly what was sent, what came back, and what it cost.
      </p>

      <Timeline focus={result?.identification.certs ?? []} highlight={linked?.ref ?? null} />

      <main className="work">
        <aside className="queue">
          <div className="queue-head">
            <h2>Tickets</h2>
            {mode === 'live' && <button className="ghost" onClick={triageAll} disabled={busy.size > 0}>Triage all</button>}
          </div>
          {mode === 'live' && <Composer onSubmit={addTicket} />}
          <ul>
            {allTickets.map(t => {
              const r = results[t.id];
              const d = r ? route(r, findings, policy) : null;
              return (
                <li key={t.id}>
                  <button className={t.id === ticket.id ? 'ticket-row active' : 'ticket-row'} onClick={() => setSelected(t.id)} aria-current={t.id === ticket.id}>
                    <span className="tid">{t.id}</span>
                    <span className="subject">{t.subject}</span>
                    {busy.has(t.id) ? <span className="route pending">Triaging</span> : d ? <RouteBadge route={d} /> : <span className="route none">Not triaged</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="detail" aria-live="polite">
          <article className="ticket">
            <p className="meta">{ticket.id}, from {ticket.reporter}</p>
            <h1>{ticket.subject}</h1>
            <blockquote>{ticket.body}</blockquote>
            {ticket.details && (
              <dl className="details" aria-label="Answers from the intake form">
                {ticket.details.cn && <div><dt>CN or hostname</dt><dd><code>{ticket.details.cn}</code></dd></div>}
                {ticket.details.error && <div><dt>Exact error</dt><dd>{ticket.details.error}</dd></div>}
                {ticket.details.client && <div><dt>Where it fails</dt><dd>{ticket.details.client}</dd></div>}
                {ticket.details.since && <div><dt>Since</dt><dd>{ticket.details.since}</dd></div>}
              </dl>
            )}
            {mode === 'live' && (
              <button className="primary" onClick={() => triage(ticket)} disabled={busy.has(ticket.id)}>
                {busy.has(ticket.id) ? 'Asking Jev…' : result ? 'Triage again' : 'Triage with Jev'}
              </button>
            )}
            {error && <p className="error" role="alert">{error}</p>}
          </article>

          {result && decision ? <>
            <Outcome route={decision} result={result}
              followUp={mode === 'recorded' ? allTickets.find(x => x.id === `${ticket.id}-R`) : undefined}
              onFollowUp={id => setSelected(id)}
              onAnswer={mode === 'live' ? d => answer(ticket, d) : undefined} />
            <ol className="steps" aria-label="How this ticket was handled">
              <FindStep result={result} />
              <SymptomStep result={result} />
              <EvidenceStep result={result} highlight={linked?.id ?? null} policy={policy} />
              <PolicyStepView route={decision} />
            </ol>
          </> : (
            <p className="empty">{mode === 'live' ? 'Select "Triage with Jev" to read this ticket and match it against the inventory findings.' : 'No recorded answer for this ticket.'}</p>
          )}
        </section>
      </main>

      <Evaluation tickets={allTickets} results={results} policy={policy} setPolicy={setPolicy} showBaseline={mode === 'recorded'} />

      <footer>
        Synthetic data only. Expiry, chain building, SAN coverage and CAA checks are ordinary code; Jev reads tickets and links them to those findings.
        Routing is a fixed policy in <code>src/pki.ts</code>. Prices from the <a href={PRICING_URL}>TypeSafe models page</a>.
        The same pattern is planned for <a href="https://github.com/certpilot/certpilot">CertPilot</a>, an open-source PKI lifecycle manager.
      </footer>
    </div>
  );
}

function RadarMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <circle cx="17" cy="17" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".6" />
      <path d="M17 17 L30 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="12.5" r="2.6" fill="var(--bad)" />
    </svg>
  );
}

// ── Validity timeline: the estate as code sees it ─────────────────────────

const START = NOW - 100 * DAY; const END = NOW + 100 * DAY;
const x = (t: number) => Math.min(100, Math.max(0, ((t - START) / (END - START)) * 100));

function Timeline({ focus, highlight }: { focus: string[]; highlight: string | null }) {
  // 500 rows would bury the signal: show certificates with findings, plus the ones the selected ticket is about.
  const rows = [
    ...endpoints.map(ep => ({ id: ep.id, label: ep.host, cert: certById(ep.cert) })),
    ...certs.filter(c => c.usage === 'client').map(c => ({ id: c.id, label: `${c.cn} (client)`, cert: c })),
  ].filter(row => findings.some(f => f.ref === row.id) || focus.includes(row.cert.id));
  const ticks = [-90, -60, -30, 0, 30, 60, 90];
  return (
    <section className="timeline" aria-label="Certificate validity by endpoint">
      <div className="timeline-head">
        <h2>Certificates that need attention</h2>
        <p>Showing {rows.length} of {certs.length} certificates: every one with a finding from the automated checks, plus the ones the selected ticket is about. Bars run from issue to expiry.</p>
      </div>
      <div className="tl-scroll">
        <div className="tl-grid">
          <div className="tl-axis" aria-hidden="true">
            {ticks.map(d => (
              <span key={d} style={{ left: `${x(NOW + d * DAY)}%` }} className={d === 0 ? 'now' : ''}>
                {d === 0 ? 'Now, 19 Sep' : new Date(NOW + d * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            ))}
          </div>
          {rows.map(row => {
            const left = daysLeft(row.cert);
            const rowFindings = findings.filter(f => f.ref === row.id);
            const state = left < 0 ? 'bad' : left <= 14 || rowFindings.length ? 'warn' : 'ok';
            const from = x(Date.parse(row.cert.notBefore)); const to = x(Date.parse(row.cert.notAfter));
            return (
              <div key={row.id} className={`tl-row ${highlight === row.id ? 'hl' : ''} ${focus.includes(row.cert.id) ? 'focus' : ''}`}>
                <div className="tl-label"><code>{row.id}</code><span>{row.label}</span></div>
                <div className="tl-track">
                  <div className="tl-now" style={{ left: `${x(NOW)}%` }} />
                  <div className={`tl-bar ${state}`} style={{ left: `${from}%`, width: `${Math.max(0.6, to - from)}%` }}
                    title={`Serial ${row.cert.serial}, valid ${row.cert.notBefore.slice(0, 10)} to ${row.cert.notAfter.slice(0, 10)}`} />
                  {rowFindings.length > 0 && (
                    <span className={`tl-flag ${state}`} style={{ left: `${x(NOW)}%` }}>{rowFindings.map(f => f.title).join('; ')}</span>
                  )}
                </div>
                <div className={`tl-days ${state}`}>{validityText(row.cert)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Ticket list and composer ──────────────────────────────────────────────

function RouteBadge({ route }: { route: Route }) {
  const text = { auto: 'Runbook ready', route_out: 'Not PKI', ask_reporter: 'Ask reporter', review: 'Human review' }[route.kind];
  return <span className={`route ${route.kind}`}>{text}</span>;
}

function Composer({ onSubmit }: { onSubmit: (subject: string, body: string, details?: Details) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cn, setCn] = useState('');
  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); if (subject.trim() && body.trim()) { onSubmit(subject.trim(), body.trim(), cn.trim() ? { cn: cn.trim() } : undefined); setSubject(''); setBody(''); setCn(''); } }}>
      <label>Write your own ticket
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={160} placeholder="Subject" />
      </label>
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={3} placeholder="Describe what users see, as a reporter would" aria-label="Ticket body" />
      <input value={cn} onChange={e => setCn(e.target.value)} maxLength={253} placeholder="Certificate CN or hostname (optional)" aria-label="Certificate CN or hostname" />
      <button className="ghost" disabled={!subject.trim() || !body.trim()}>Add and triage</button>
    </form>
  );
}

// ── Outcome and cost ──────────────────────────────────────────────────────

const nextStep: Record<Route['kind'], string> = {
  auto: 'An on-call engineer confirms the step above and runs it. CertRadar only suggests it; nothing is executed automatically.',
  review: 'The ticket goes to the PKI queue with Jev\'s reading and the strongest finding attached, so the engineer starts with a lead.',
  ask_reporter: 'CertRadar sends the reporter four questions: the certificate\'s CN or hostname, the exact error, where it fails, and since when. Their answers go into the same triage again.',
  route_out: 'The ticket goes to the team that owns the service, with a note that the certificate inventory shows nothing related.',
};

const outcomeHeading: Record<Route['kind'], string> = {
  auto: 'Runbook ready',
  route_out: 'Hand to the owning team',
  ask_reporter: 'Ask the reporter for details',
  review: 'Send to a PKI engineer',
};

function Outcome({ route, result, followUp, onFollowUp, onAnswer }: {
  route: Route; result: Triage; followUp?: Ticket; onFollowUp: (id: string) => void; onAnswer?: (d: Details) => void;
}) {
  const cost = costUSD(result.model, result.usage);
  const price = pricing[result.model];
  return (
    <section className={`outcome ${route.kind}`}>
      <div className="outcome-main">
        <h2>{outcomeHeading[route.kind]}</h2>
        <p>{route.reason}</p>
        {route.kind === 'auto' && <p className="action"><code>{route.finding.action}</code></p>}
        {route.kind === 'review' && route.finding && <p className="hint">Best lead for the engineer: {route.finding.title}.</p>}
        <p className="next"><b>What happens next.</b> {route.kind === 'review' && !route.finding
          ? 'The ticket goes to the PKI queue with Jev\'s reading attached. No finding matched, so the inventory may not cover this service yet.'
          : nextStep[route.kind]}</p>
        {route.kind === 'ask_reporter' && onAnswer && <AskForm onSubmit={onAnswer} />}
        {route.kind === 'ask_reporter' && followUp && (
          <button className="ghost follow" onClick={() => onFollowUp(followUp.id)}>See the triage after the reporter answered</button>
        )}
      </div>
      <div className="receipt" aria-label="What this decision cost">
        <h3>Cost of this decision</h3>
        <p className="receipt-total">{usd(cost)}</p>
        <dl>
          <div><dt>Input tokens</dt><dd>{int(result.usage.input_tokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{int(result.usage.output_tokens)} <small>free</small></dd></div>
          <div><dt>Time</dt><dd>{int(result.latencyMs)} ms</dd></div>
          <div><dt>Model</dt><dd>{result.model}</dd></div>
        </dl>
        <Timing result={result} />
        <p className="receipt-note">
          {price ? <>Billed at ${price.inputPerMTok} per million input tokens. </> : <>No published price for this model in the table. </>}
          The rule checks ran in code at no cost.
        </p>
      </div>
    </section>
  );
}

const callTitle: Record<JevCall['name'], string> = { symptoms: 'Read the ticket', evidence: 'Match the evidence' };
const parallel = (r: Triage) => (r.calls[1]?.startedAtMs ?? 0) < (r.calls[0]?.latencyMs ?? 0);

function AskForm({ onSubmit }: { onSubmit: (d: Details) => void }) {
  const [d, setD] = useState<Details>({});
  const field = (key: keyof Details, label: string, placeholder: string) => (
    <label>{label}<input value={d[key] ?? ''} onChange={e => setD({ ...d, [key]: e.target.value })} maxLength={key === 'cn' ? 253 : 200} placeholder={placeholder} /></label>
  );
  return (
    <form className="ask-form" onSubmit={e => { e.preventDefault(); if (d.cn?.trim()) onSubmit(Object.fromEntries(Object.entries(d).filter(([, v]) => v?.trim())) as Details); }}>
      <p>Answer as the reporter would:</p>
      {field('cn', 'Certificate CN or hostname', 'shop.acme-retail.test')}
      {field('error', 'Exact error', 'NET::ERR_CERT_DATE_INVALID')}
      {field('client', 'Where it fails', 'Chrome on Windows, Android app, a Java job...')}
      {field('since', 'Since when', 'This morning')}
      <button className="primary" disabled={!d.cn?.trim()}>Send answers and triage again</button>
    </form>
  );
}

/** Both Jev requests on one time axis, so their overlap is visible. */
function Timing({ result }: { result: Triage }) {
  const total = Math.max(result.latencyMs, ...result.calls.map(c => c.startedAtMs + c.latencyMs));
  return (
    <div className="timing">
      {result.calls.map(c => (
        <div key={c.name} className="timing-row">
          <span>{callTitle[c.name]}</span>
          <span className="timing-track"><i style={{ left: `${(c.startedAtMs / total) * 100}%`, width: `${Math.max(2, (c.latencyMs / total) * 100)}%` }} /></span>
          <span>{int(c.latencyMs)} ms</span>
        </div>
      ))}
      {result.calls.length > 1 && (parallel(result)
        ? <p>Both requests run at the same time, so the ticket takes as long as the slower one.</p>
        : <p>The second request waited for Jev's service pick, because the ticket named no host.</p>)}
    </div>
  );
}

// ── The four steps ────────────────────────────────────────────────────────

function Step({ n, who, title, summary, meta, children, call }: {
  n: number; who: 'code' | 'jev'; title: string; summary: ReactNode; meta?: ReactNode; children?: ReactNode; call?: JevCall;
}) {
  return (
    <li className={`step ${who}`}>
      <div className="step-marker" aria-hidden="true">{n}</div>
      <div className="step-body">
        <div className="step-head">
          <h3>{title}</h3>
          <span className={`who ${who}`}>{who === 'jev' ? 'Jev' : 'Code'}</span>
          {meta && <span className="step-meta">{meta}</span>}
        </div>
        <p className="step-summary">{summary}</p>
        {children}
        {call && <Inspector call={call} />}
      </div>
    </li>
  );
}

function CallMeta({ call }: { call: JevCall }) {
  return <>{int(call.latencyMs)} ms, {int(call.response.usage.input_tokens)} tokens in, {usd(costUSD(call.response.model, call.response.usage))}</>;
}

function FindStep({ result }: { result: Triage }) {
  const id = result.identification;
  const svc = id.service ? `"${serviceName(id.service)}" (${pct(result.service.probabilities[id.service] ?? 0)})` : '';
  const summary = {
    form: <>The reporter typed <code>{id.names[0]}</code> into the form. Code looked it up exactly among {certs.length} certificates and found <b>{id.matched}</b>.</>,
    text: <>Code found <code>{id.names.join(', ')}</code> in the ticket text and looked {id.names.length > 1 ? 'them' : 'it'} up exactly among {certs.length} certificates: <b>{id.matched} matched</b>.</>,
    service: <>The ticket names no host, so code used Jev's service pick from step 2, {svc}, and looked up that service's certificates: <b>{id.matched} of {certs.length}</b>.</>,
    none: <>The ticket names no known host{id.unmatched.length ? <> (<code>{id.unmatched.join(', ')}</code> is not in the inventory)</> : null}, and Jev could not tell which service it is about. There is nothing to look up.</>,
  }[id.source];
  const tooMany = id.matched > MAX_CANDIDATES;
  return (
    <Step n={1} who="code" title="Found the certificates to check" meta="No model call, $0"
      summary={<>{summary} {tooMany
        ? <>That is more than the {MAX_CANDIDATES} CertRadar will hand to Jev, so it asks for the exact CN instead of guessing.</>
        : id.certs.length ? <>Only these go to Jev. The other {certs.length - id.certs.length} certificates never leave the server.</> : null}</>}>
      {id.certs.length > 0 && (
        <div className="table-wrap">
          <table className="cands">
            <thead><tr><th>Certificate</th><th>Serial</th><th>Issuer</th><th>Where it is used</th><th>Validity</th><th>Findings</th></tr></thead>
            <tbody>
              {id.certs.map(cid => {
                const c = certById(cid); const left = daysLeft(c);
                const where = endpoints.filter(e => e.cert === cid).map(e => e.id).join(', ') || (c.usage === 'client' ? 'client certificate' : 'not deployed');
                const fs = findings.filter(f => (endpoints.find(e => e.id === f.ref)?.cert ?? f.ref) === cid);
                return (
                  <tr key={cid}>
                    <td><code>{c.cn}</code></td><td><code>{c.serial}</code></td><td>{caName(c.issuer)}</td><td>{where}</td>
                    <td className={left < 0 ? 'miss' : ''}>{validityText(c)}</td>
                    <td>{fs.length ? fs.map(f => f.title).join('; ') : 'none'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Step>
  );
}

const questionType = (q: { type: string; criteria?: unknown }) =>
  q.type === 'choice' ? `Choice, ${Object.keys(q.criteria as object).length} options` : q.type === 'score' ? `Score, ${(q.criteria as unknown[]).length} levels` : 'Yes or no';

function Asked({ q, children }: { q: { type: string; instructions?: unknown; criteria?: unknown }; children: ReactNode }) {
  return (
    <div className="asked">
      <p className="asked-q"><span className="qtype">{questionType(q)}</span> <Inline text={String(q.instructions)} /></p>
      {children}
    </div>
  );
}

/** Question text references state fields in backticks; show those as code. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part)}</>;
}

function SymptomStep({ result }: { result: Triage }) {
  const call = result.calls.find(c => c.name === 'symptoms')!;
  const q = call.request.questions;
  const sorted = [...causes].sort((a, b) => result.cause.probabilities[b] - result.cause.probabilities[a]);
  const level = Math.min(3, Math.max(0, Math.round(result.urgency.score)));
  return (
    <Step n={2} who="jev" title="Jev read the ticket" meta={<CallMeta call={call} />} call={call}
      summary={<>Jev received <b>only the ticket</b>: no certificates and no findings. It answered three typed questions. Because it never sees
        the evidence here, its reading is an independent opinion that step 4 checks against the findings. The service pick is only used when the
        ticket names no host.</>}>
      <Asked q={q.cause}>
        <ul className="dist">
          {sorted.map(c => (
            <li key={c} className={c === result.cause.choice ? 'top' : ''}>
              <span>{causeLabels[c]}</span><Bar value={result.cause.probabilities[c]} /><b>{pct(result.cause.probabilities[c])}</b>
            </li>
          ))}
        </ul>
        <p className="answer">Answer: <b>{causeLabels[result.cause.choice]}</b>, confidence {pct(result.cause.confidence)}.</p>
      </Asked>
      <Asked q={q.urgency}>
        <ul className="dist">
          {urgencyLevels.map((label, i) => (
            <li key={label} className={i === level ? 'top' : ''}>
              <span>{label}</span><Bar value={result.urgency.probabilities[i] ?? 0} /><b>{pct(result.urgency.probabilities[i] ?? 0)}</b>
            </li>
          ))}
        </ul>
      </Asked>
      <Asked q={q.service}>
        <ul className="dist">
          {Object.entries(result.service.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sid, p]) => (
            <li key={sid} className={sid === result.service.choice ? 'top' : ''}>
              <span>{serviceName(sid)}</span><Bar value={p} /><b>{pct(p)}</b>
            </li>
          ))}
        </ul>
        <p className="answer">Top 5 of {Object.keys(result.service.probabilities).length} options. Answer: <b>{serviceName(result.service.choice)}</b>, confidence {pct(result.service.confidence)}.</p>
      </Asked>
    </Step>
  );
}

function EvidenceStep({ result, highlight, policy }: { result: Triage; highlight: string | null; policy: Policy }) {
  const call = result.calls.find(c => c.name === 'evidence');
  const sent = findings.filter(f => f.id in result.links).sort((a, b) => result.links[b.id] - result.links[a.id]);
  const n = result.identification.certs.length;
  if (!call) {
    return (
      <Step n={3} who="jev" title="Jev matched the ticket to the findings" meta="Skipped, $0"
        summary={n ? <>The {n} matched certificate{n === 1 ? ' has' : 's have'} no findings, so there was nothing for Jev to confirm and no second request was sent.</>
          : <>There were no certificates to check, so no second request was sent.</>} />
    );
  }
  const example = Object.values(call.request.questions)[0];
  return (
    <Step n={3} who="jev" title="Jev matched the ticket to the findings" meta={<CallMeta call={call} />} call={call}
      summary={<>A second request, {parallel(result) ? 'sent at the same time as step 2' : 'sent after Jev picked the service'}, gave Jev the same ticket plus
        only the {n} certificate{n === 1 ? '' : 's'} from step 1 and {sent.length === 1 ? 'its finding' : `their ${sent.length} findings`}. It asked one yes-or-no
        question per finding. Findings at or above the {pct(policy.link)} line count as evidence.</>}>
      <p className="asked-q"><span className="qtype">Yes or no, asked {sent.length} time{sent.length === 1 ? '' : 's'}</span> <Inline text={String(example.instructions).replace('findings[0]', 'findings[i]')} /></p>
      <ol className="evidence">
        {sent.map((f: Finding) => {
          const p = result.links[f.id];
          return (
            <li key={f.id} className={`${f.id === highlight ? 'hl' : ''} ${p >= policy.link ? 'linked' : ''}`}>
              <div className="ev-top"><span className="ev-title">{f.title}</span><b>{pct(p)}</b></div>
              <span className="bar-wrap"><Bar value={p} tone={p >= policy.link ? 'jev' : 'dim'} /><i style={{ left: `${policy.link * 100}%` }} /></span>
              <p>{f.detail}</p>
            </li>
          );
        })}
      </ol>
    </Step>
  );
}

function PolicyStepView({ route }: { route: Route }) {
  return (
    <Step n={4} who="code" title="Applied the routing policy" meta="No model call, $0"
      summary={<>Jev never decides what happens. Code checks its answers against fixed rules, in order, and stops at the first rule that fails.
        The thresholds are the sliders in the evaluation panel below.</>}>
      <ol className="rules">
        {route.steps.map(s => (
          <li key={s.rule} className={s.outcome}>
            <span className="rule-mark" aria-label={s.outcome === 'pass' ? 'Passed' : 'Failed'}>{s.outcome === 'pass' ? '✓' : '✕'}</span>
            <div><b>{s.rule}</b><p>{s.detail}</p></div>
          </li>
        ))}
      </ol>
      {route.steps.at(-1)?.outcome === 'fail' && <p className="skipped">Later rules were not checked, because this one decides the route.</p>}
      <p className="answer">Result: <RouteBadge route={route} /></p>
    </Step>
  );
}

// ── Raw input and output ──────────────────────────────────────────────────

function Inspector({ call }: { call: JevCall }) {
  return (
    <details className="inspector">
      <summary>Show exactly what Jev received and returned</summary>
      <div className="inspector-grid">
        <JsonPane title="Sent to Jev" note={`POST /v1/systemone, ${int(call.response.usage.input_tokens)} input tokens`} value={call.request} />
        <JsonPane title="Jev returned" note={`model ${call.response.model}, ${int(call.response.usage.output_tokens)} output tokens, ${int(call.latencyMs)} ms`} value={call.response} />
      </div>
      {call.name === 'evidence' && <p className="inspector-note">Answers <code>link_0</code> to <code>link_{Object.keys(call.request.questions).length - 1}</code> follow the order of <code>state.findings</code>: <code>link_0</code> is the first finding, and so on.</p>}
      <p className="inspector-note">The API key travels in a request header on the server and never appears here or in the browser.</p>
    </details>
  );
}

function JsonPane({ title, note, value }: { title: string; note: string; value: unknown }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="json-pane">
      <div className="json-head">
        <div><b>{title}</b><span>{note}</span></div>
        <button className="ghost small" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      <pre className="json" tabIndex={0}><code>{highlight(text)}</code></pre>
    </div>
  );
}

/** Minimal JSON syntax colouring built from React nodes (no innerHTML). */
function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = m[1] ? (m[2] ? 'k' : 's') : m[3] ? 'b' : 'n';
    out.push(<span key={m.index} className={`j-${cls}`}>{m[1] ?? m[0]}</span>);
    if (m[2]) out.push(m[2]);
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}

function Bar({ value, tone = 'jev' }: { value: number; tone?: string }) {
  return <span className={`bar ${tone}`}><span style={{ width: `${Math.max(1, value * 100)}%` }} /></span>;
}

/** Jev against the same pipeline driven by an ordinary LLM, on the tickets both were measured on. */
function Comparison({ policy }: { policy: Policy }) {
  const ids: string[] = baseline.tickets;
  const engines = [
    { label: 'Jev', results: recordedResults },
    ...Object.values(baseline.runs as Record<string, { model: string; results: Record<string, Triage> }>).map(r => ({ label: 'Ordinary LLM', results: r.results as unknown as Record<string, Triage> })),
  ];
  const stats = engines.map(({ label, results }) => {
    const rows = ids.map(id => {
      const ticket = sampleTickets.find(t => t.id === id)!;
      const r = results[id]; const d = route(r, findings, policy);
      return { r, d, g: grade(ticket, r, d, policy)! };
    });
    const causeRows = rows.filter(x => x.g.causeCorrect !== null);
    const times = rows.map(x => x.r.latencyMs).sort((a, b) => a - b);
    const cost = rows.reduce((n, x) => n + (costUSD(x.r.model, x.r.usage) ?? 0), 0);
    return {
      label, model: rows[0].r.model,
      handled: rows.filter(x => x.d.kind === 'auto' || x.d.kind === 'route_out').length,
      wrong: rows.filter(x => x.g.wrongAuto).length,
      cause: `${causeRows.filter(x => x.g.causeCorrect).length} of ${causeRows.length}`,
      median: times[Math.floor(times.length / 2)],
      perThousand: (cost / ids.length) * 1000,
    };
  });
  return (
    <section className="compare">
      <h3>The same pipeline driven by an ordinary LLM</h3>
      <p>Same tickets, same lookup code, same routing policy: only the decision engine changes. The baseline asks the same questions
        through structured JSON output. Measured on the {ids.length} tickets that fit the baseline's free-tier quota.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Engine</th><th>Model</th><th className="num">Routed without a human</th><th className="num">Wrong actions</th><th className="num">Cause correct</th><th className="num">Median</th><th className="num">Cost per 1,000 tickets</th></tr></thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.label}>
                <td><b>{s.label}</b></td><td><code>{s.model}</code></td>
                <td className="num">{s.handled} of {ids.length}</td>
                <td className={s.wrong ? 'num miss' : 'num'}>{s.wrong}</td>
                <td className="num">{s.cause}</td>
                <td className="num">{int(s.median)} ms</td>
                <td className="num">{usd(s.perThousand)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="compare-note">Accuracy is a tie here, and they miss different tickets. The difference is in the probabilities:
        the baseline answered <b>1.00</b> to every evidence question, including a stale-certificate finding against a ticket about payment
        timeouts (T-110), where Jev answered 0.29. Only the baseline's own low cause confidence kept that one from becoming an action.</p>
    </section>
  );
}

// ── Evaluation: labelled tickets, thresholds recomputed without new calls ──

function Evaluation({ tickets, results, policy, setPolicy, showBaseline }: { tickets: Ticket[]; results: Record<string, Triage>; policy: Policy; setPolicy: (p: Policy) => void; showBaseline: boolean }) {
  const rows = useMemo(() => tickets.filter(t => t.label && results[t.id]).map(t => {
    const r = results[t.id]; const d = route(r, findings, policy);
    return { t, r, d, g: grade(t, r, d, policy)!, cost: costUSD(r.model, r.usage) };
  }), [tickets, results, policy]);
  if (!rows.length) return null;
  const causeRows = rows.filter(x => x.g.causeCorrect !== null);
  const auto = rows.filter(x => x.d.kind === 'auto' || x.d.kind === 'route_out');
  const wrong = rows.filter(x => x.g.wrongAuto).length;
  const latencies = rows.map(x => x.r.latencyMs).sort((a, b) => a - b);
  const priced = rows.every(x => x.cost !== null);
  const totalCost = rows.reduce((n, x) => n + (x.cost ?? 0), 0);
  const totalIn = rows.reduce((n, x) => n + x.r.usage.input_tokens, 0);
  const slider = (key: keyof Policy, label: string, help: string) => (
    <label className="slider">
      <span>{label} <b>{pct(policy[key])}</b></span>
      <input type="range" min={0.05} max={0.95} step={0.05} value={policy[key]} onChange={e => setPolicy({ ...policy, [key]: Number(e.target.value) })} />
      <small>{help}</small>
    </label>
  );
  return (
    <section className="eval">
      <div className="eval-head">
        <div>
          <h2>How the policy performs on labelled tickets</h2>
          <p>Change a threshold and every route is recomputed from the same Jev answers, with no new API calls and no extra cost.</p>
        </div>
        <button className="ghost" onClick={() => setPolicy(defaultPolicy)}>Reset thresholds</button>
      </div>
      <div className="sliders">
        {slider('confidence', 'Minimum cause confidence', 'Below this, a PKI engineer decides.')}
        {slider('link', 'Minimum evidence link', 'A finding must reach this to count as evidence.')}
        {slider('service', 'Minimum service confidence', 'When a ticket names no host, Jev must be this sure which service it is.')}
      </div>
      <dl className="scores">
        <div><dt>Handled without a human</dt><dd>{auto.length} of {rows.length}</dd></div>
        <div className={wrong ? 'bad' : ''}><dt>Wrong automatic actions</dt><dd>{wrong}</dd></div>
        <div><dt>Cause read correctly</dt><dd>{causeRows.filter(x => x.g.causeCorrect).length} of {causeRows.length}</dd></div>
        <div><dt>Median time per ticket</dt><dd>{int(latencies[Math.floor(latencies.length / 2)])} ms</dd></div>
      </dl>
      <dl className="scores cost-scores">
        <div><dt>Jev cost for these {rows.length} tickets</dt><dd>{priced ? usd(totalCost) : 'n/a'}</dd></div>
        <div><dt>Average per ticket</dt><dd>{priced ? usd(totalCost / rows.length) : 'n/a'}</dd></div>
        <div><dt>At this rate, 1,000 tickets</dt><dd>{priced ? usd((totalCost / rows.length) * 1000) : 'n/a'}</dd></div>
        <div><dt>Input tokens billed</dt><dd>{int(totalIn)}</dd></div>
      </dl>
      {showBaseline && <Comparison policy={policy} />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ticket</th><th>Labelled cause</th><th>Jev's reading</th><th>Top finding</th><th>Route</th><th className="num">Time</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {rows.map(({ t, r, d, g, cost }) => {
              const top = Object.entries(r.links).sort((a, b) => b[1] - a[1])[0];
              return (
                <tr key={t.id}>
                  <td><code>{t.id}</code> {t.subject}</td>
                  <td>{t.label!.cause ? causeLabels[t.label!.cause] : 'Too vague to label'}</td>
                  <td className={g.causeCorrect === false ? 'miss' : ''}>{causeLabels[r.cause.choice]} <small>{pct(r.cause.confidence)}</small></td>
                  <td className={g.findingCorrect === false ? 'miss' : ''}>{top && top[1] >= policy.link ? `${findings.find(f => f.id === top[0])!.title} (${pct(top[1])})` : 'None above threshold'}</td>
                  <td><RouteBadge route={d} />{g.wrongAuto && <span className="flag-wrong">wrong</span>}</td>
                  <td className="num">{int(r.latencyMs)} ms</td>
                  <td className="num">{usd(cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
