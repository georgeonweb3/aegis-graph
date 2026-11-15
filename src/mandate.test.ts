/**
 * Mandate engine tests — run with: pnpm test
 * (compiles src/mandate.ts with tsc, then runs node:test against dist/)
 *
 * These tests are the quantified proof for the submission: the README
 * quotes the real pass count from this file, never a claimed number.
 *
 * Reuse disclosure: the mandate engine under test here is George
 * Agbe's own earlier code, copied from the Aegis-for-Jira Codegeist
 * 2026 scaffold (MIT) — see the header of mandate.ts. The tests
 * themselves are likewise carried over and still pass against the
 * unchanged engine; the new tests for this repo live in graph.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpend, parseSpendFromText } from './mandate';
import type { Mandate, SpendRequest } from './mandate';

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: 'test',
    name: 'Test mandate',
    monthlyCapUsd: 1000,
    perItemCapUsd: 500,
    approvedVendors: ['Acme Corp', 'Globex'],
    monthKey: '2026-11',
    spentThisMonthUsd: 0,
    ...overrides,
  };
}

function request(overrides: Partial<SpendRequest> = {}): SpendRequest {
  return {
    issueKey: 'PROJ-123',
    vendor: 'Acme Corp',
    amountUsd: 150,
    ...overrides,
  };
}

test('under all caps with an approved vendor approves', () => {
  const v = checkSpend(mandate(), request());
  assert.equal(v.decision, 'APPROVED');
  assert.equal(v.remainingAfterApprovalUsd, 850);
});

test('unapproved vendor blocks', () => {
  const v = checkSpend(mandate(), request({ vendor: 'Umbrella Ltd' }));
  assert.equal(v.decision, 'BLOCKED');
  assert.match(v.reasons.join(' '), /not approved/);
});

test('vendor lookalike does not match the allow-list', () => {
  // "Acme Corp Ltd" is not "Acme Corp" — suffix spoofing is blocked.
  const v = checkSpend(mandate(), request({ vendor: 'Acme Corp Ltd' }));
  assert.equal(v.decision, 'BLOCKED');
  // A hyphenated lookalike is blocked too.
  const v2 = checkSpend(mandate(), request({ vendor: 'acme-corp.io' }));
  assert.equal(v2.decision, 'BLOCKED');
});

test('vendor matching is case-insensitive', () => {
  const v = checkSpend(mandate(), request({ vendor: 'ACME CORP' }));
  assert.equal(v.decision, 'APPROVED');
});

test('amount over the per-item cap blocks', () => {
  const v = checkSpend(mandate(), request({ amountUsd: 600 }));
  assert.equal(v.decision, 'BLOCKED');
  assert.match(v.reasons.join(' '), /per-item cap/);
});

test('amount exactly at the per-item cap passes the cap check (a max-size payment still gets a human look)', () => {
  const v = checkSpend(mandate(), request({ amountUsd: 500 }));
  // The per-item cap is inclusive: exactly at the cap does not breach it.
  assert.equal(v.checks.find((c) => c.name === 'per-item-cap')?.passed, true);
  // But a payment at 100% of the cap is over the 80% review line, so a
  // human looks at it instead of it auto-approving.
  assert.equal(v.decision, 'NEEDS_REVIEW');
});

test('monthly cap breach blocks with the overage stated', () => {
  const v = checkSpend(mandate({ spentThisMonthUsd: 800 }), request({ amountUsd: 300 }));
  assert.equal(v.decision, 'BLOCKED');
  assert.match(v.reasons.join(' '), /\$100\.00 over/);
});

test('amount exactly filling the monthly cap passes the cap check (leaving $0 still gets a human look)', () => {
  const v = checkSpend(mandate({ spentThisMonthUsd: 800 }), request({ amountUsd: 200 }));
  // The monthly cap is inclusive: exactly filling it does not breach it.
  assert.equal(v.checks.find((c) => c.name === 'monthly-cap')?.passed, true);
  assert.equal(v.remainingAfterApprovalUsd, 0);
  // But approval would leave $0 of the budget, under the 10% review line.
  assert.equal(v.decision, 'NEEDS_REVIEW');
});

test('zero amount blocks', () => {
  const v = checkSpend(mandate(), request({ amountUsd: 0 }));
  assert.equal(v.decision, 'BLOCKED');
});

test('negative amount blocks', () => {
  const v = checkSpend(mandate(), request({ amountUsd: -50 }));
  assert.equal(v.decision, 'BLOCKED');
});

test('NaN amount blocks', () => {
  const v = checkSpend(mandate(), request({ amountUsd: NaN }));
  assert.equal(v.decision, 'BLOCKED');
});

test('split payment: small requests that together break the monthly cap block', () => {
  // Two $400 requests already recorded, monthly cap $1,000, spent $0.
  // Each alone looks fine; together with the new $400 they reach $1,200.
  const recent = [
    request({ issueKey: 'PROJ-120', amountUsd: 400 }),
    request({ issueKey: 'PROJ-121', amountUsd: 400 }),
  ];
  const v = checkSpend(mandate(), request({ amountUsd: 400 }), recent);
  assert.equal(v.decision, 'BLOCKED');
  assert.match(v.reasons.join(' '), /Split-payment/);
});

test('one recent same-vendor request under the cap still approves', () => {
  const recent = [request({ issueKey: 'PROJ-120', amountUsd: 100 })];
  const v = checkSpend(mandate(), request({ amountUsd: 100 }), recent);
  assert.equal(v.decision, 'APPROVED');
});

test('two or more recent payments to the same vendor need review', () => {
  const recent = [
    request({ issueKey: 'PROJ-120', amountUsd: 50 }),
    request({ issueKey: 'PROJ-121', amountUsd: 50 }),
  ];
  const v = checkSpend(mandate(), request({ amountUsd: 50 }), recent);
  assert.equal(v.decision, 'NEEDS_REVIEW');
});

test('amount over 80% of the per-item cap needs review', () => {
  const v = checkSpend(mandate(), request({ amountUsd: 450 }));
  assert.equal(v.decision, 'NEEDS_REVIEW');
  assert.match(v.reasons.join(' '), /80%/);
});

test('approval that leaves under 10% of the monthly budget needs review', () => {
  const v = checkSpend(mandate({ spentThisMonthUsd: 850 }), request({ amountUsd: 100 }));
  assert.equal(v.decision, 'NEEDS_REVIEW');
  assert.match(v.reasons.join(' '), /leaves only \$50\.00/);
});

test('multiple failures are all reported, not just the first', () => {
  const v = checkSpend(mandate(), request({ vendor: 'Umbrella Ltd', amountUsd: 900 }));
  assert.equal(v.decision, 'BLOCKED');
  assert.ok(v.reasons.length >= 2, `expected 2+ reasons, got ${v.reasons.length}`);
  assert.ok(v.checks.filter((c) => !c.passed).length >= 2);
});

test('parseSpendFromText finds amount and vendor', () => {
  const p = parseSpendFromText('Pay the vendor invoice.\nVendor: Acme Corp\nTotal: $2,400 due Friday.');
  assert.equal(p.amountUsd, 2400);
  assert.equal(p.vendor, 'Acme Corp');
});

test('parseSpendFromText handles decimals and commas', () => {
  const p = parseSpendFromText('Renewal is $1,250.50 per year.');
  assert.equal(p.amountUsd, 1250.5);
  assert.equal(p.vendor, undefined);
});

test('parseSpendFromText returns empty when nothing is there', () => {
  const p = parseSpendFromText('Fix the login button on the settings page.');
  assert.equal(p.amountUsd, undefined);
  assert.equal(p.vendor, undefined);
});
