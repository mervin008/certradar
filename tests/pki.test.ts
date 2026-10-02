import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATES, buildPath, certs, certsForName, clients, costUSD, coversHost, endpoints, identify, identifyByService, route, runChecks, grade, tickets, type Identification, type Triage } from '../src/pki';

const ep = (id: string) => endpoints.find(e => e.id === id)!;
const client = (id: string) => clients.find(c => c.id === id)!;

describe('deterministic PKI checks', () => {
  it('builds a reproducible 500-certificate estate', () => {
    expect(certs).toHaveLength(500);
    expect(new Set(certs.map(c => c.id)).size).toBe(500);
  });
  it('finds exactly the planted and naturally occurring problems', () => {
    expect(runChecks().map(f => f.id).sort()).toEqual([
      'chain:edge-03', 'expired:c-partner', 'expired:n-reports', 'expiring:n-kafka-17', 'expiring:n-pg-05', 'name:edge-04',
      'renewal:c-status', 'stale:edge-02', 'stale:n-orders-17', 'trust:edge-06', 'trust:svc-billing',
    ]);
  });
  it('matches SANs exactly and wildcards one label deep', () => {
    expect(coversHost(['acme-retail.test'], 'www.acme-retail.test')).toBe(false);
    expect(coversHost(['*.acme-retail.test'], 'www.acme-retail.test')).toBe(true);
    expect(coversHost(['*.acme-retail.test'], 'a.b.acme-retail.test')).toBe(false);
  });
  it('builds chains the way a TLS client does', () => {
    expect(buildPath(ep('edge-03'), client('browsers')).ok).toBe(true);
    expect(buildPath(ep('edge-03'), client('android-app'))).toMatchObject({ ok: false, reason: 'missing_intermediate', missing: 'int-nova-tls1' });
    expect(buildPath(ep('edge-01'), client('ios12'))).toMatchObject({ ok: true, path: ['int-nova-tls1', 'xsign-nova-r2', 'root-legacy'] });
    expect(buildPath(ep('edge-06'), client('ios12'))).toMatchObject({ ok: false, reason: 'untrusted_root' });
    expect(buildPath(ep('svc-billing'), client('legacy-batch'))).toMatchObject({ ok: false, reason: 'untrusted_root' });
  });
  it('flags a blocked renewal with the CAA record that blocks it', () => {
    const renewal = runChecks().find(f => f.id === 'renewal:c-status')!;
    expect(renewal.detail).toContain('allows only nova-ca.test');
  });
});

const findings = runChecks();
function triage(overrides: Partial<Triage> & { links?: Record<string, number> }): Triage {
  return {
    cause: { choice: 'deployment_mismatch', confidence: 0.95, probabilities: {} as Triage['cause']['probabilities'] },
    urgency: { score: 2, confidence: 1, probabilities: [0, 0, 1, 0] },
    service: { choice: 'shop', confidence: 0.9, probabilities: { shop: 0.9 } },
    identification: { source: 'text', names: ['shop.acme-retail.test'], unmatched: [], matched: 2, certs: ['c-shop-new', 'c-shop-old'] },
    links: { 'stale:edge-02': 0.9 }, model: 'test', latencyMs: 1, usage: { input_tokens: 1, output_tokens: 1 }, calls: [],
    ...overrides,
  };
}

describe('routing policy', () => {
  it('runs the runbook only when cause and evidence agree', () => {
    expect(route(triage({}), findings)).toMatchObject({ kind: 'auto', finding: { id: 'stale:edge-02' } });
  });
  it('asks the reporter when it cannot tell which certificate the ticket is about', () => {
    const none: Identification = { source: 'none', names: [], unmatched: [], matched: 0, certs: [] };
    expect(route(triage({ identification: none, links: {} }), findings).kind).toBe('ask_reporter');
    const broad = identifyByService('orders');
    expect(route(triage({ identification: broad, links: {} }), findings)).toMatchObject({ kind: 'ask_reporter' });
    const unsure = { ...identifyByService('api'), certs: ['c-api'] };
    expect(route(triage({ identification: unsure, service: { choice: 'api', confidence: 0.4, probabilities: { api: 0.4 } }, links: { 'chain:edge-03': 0.9 } }), findings).kind).toBe('ask_reporter');
  });
  it('never asks for a CN when the ticket is not about certificates', () => {
    const none: Identification = { source: 'none', names: [], unmatched: [], matched: 0, certs: [] };
    const notCert = { choice: 'not_certificate' as const, confidence: 0.9, probabilities: {} as never };
    expect(route(triage({ cause: notCert, identification: none, links: {} }), findings).kind).toBe('route_out');
  });
  it('sends low confidence, missing evidence, and disagreement to a human', () => {
    expect(route(triage({ cause: { choice: 'deployment_mismatch', confidence: 0.4, probabilities: {} as never } }), findings).kind).toBe('review');
    expect(route(triage({ links: { 'stale:edge-02': 0.2 } }), findings).kind).toBe('review');
    expect(route(triage({ cause: { choice: 'name_mismatch', confidence: 0.9, probabilities: {} as never } }), findings).kind).toBe('review');
  });
  it('does not route a ticket away from PKI when a finding strongly matches it', () => {
    const notCert = { choice: 'not_certificate' as const, confidence: 0.9, probabilities: {} as never };
    expect(route(triage({ cause: notCert, links: {} }), findings).kind).toBe('route_out');
    expect(route(triage({ cause: notCert }), findings).kind).toBe('review');
  });
  it('counts a wrong automatic runbook as a wrong action', () => {
    const t101 = tickets.find(t => t.id === 'T-101')!;
    const wrong = triage({ cause: { choice: 'name_mismatch', confidence: 0.9, probabilities: {} as never }, links: { 'name:edge-04': 0.9 } });
    expect(grade(t101, wrong, route(wrong, findings))).toMatchObject({ causeCorrect: false, wrongAuto: true });
  });
});

describe('cost', () => {
  it('bills input tokens at the published rate and output tokens at zero', () => {
    expect(costUSD('jev-1.13.0', { input_tokens: 1_000_000, output_tokens: 500_000 })).toBeCloseTo(0.042, 10);
  });
  it('refuses to guess a price for an unknown model', () => {
    expect(costUSD('jev-9.9.9', { input_tokens: 1000, output_tokens: 0 })).toBeNull();
  });
});

describe('policy trail', () => {
  it('lists every rule it checked, in order, and stops at the first failure', () => {
    expect(route(triage({}), findings).steps.map(s => s.outcome)).toEqual(['pass', 'pass', 'pass', 'pass']);
    const unknown = route(triage({ identification: { source: 'none', names: [], unmatched: [], matched: 0, certs: [] }, links: {} }), findings);
    expect(unknown.steps).toHaveLength(1);
    expect(unknown.steps[0]).toMatchObject({ outcome: 'fail', rule: 'Do we know which certificate it is about?' });
  });
});

describe('lookup', () => {
  it('matches a CN or hostname exactly, including every endpoint that serves it', () => {
    expect(certsForName('shop.acme-retail.test').sort()).toEqual(['c-shop-new', 'c-shop-old']);
    expect(certsForName('WWW.acme-retail.test')).toEqual(['c-www']);
    expect(certsForName('nothing.acme-retail.test')).toEqual([]);
  });
  it('prefers the form CN, then hostnames in the text, and ignores lookalike tokens', () => {
    expect(identify({ subject: 'x', body: 'billing.internal.test fails', details: { cn: 'www.acme-retail.test' } })).toMatchObject({ source: 'form', certs: ['c-www'] });
    expect(identify({ subject: 'x', body: 'javax.net.ssl.SSLHandshakeException from billing.internal.test' })).toMatchObject({ source: 'text', names: ['billing.internal.test'], certs: ['c-billing'] });
    expect(identify({ subject: 'x', body: 'grafana-eu.internal.test is broken' })).toMatchObject({ source: 'none', unmatched: ['grafana-eu.internal.test'] });
  });
  it('refuses to hand Jev a service with too many certificates', () => {
    const orders = identifyByService('orders');
    expect(orders.matched).toBeGreaterThan(MAX_CANDIDATES);
    expect(orders.certs).toEqual([]);
    expect(identifyByService('northwind').certs).toEqual(['c-partner']);
  });
});
