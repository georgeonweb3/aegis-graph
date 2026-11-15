/**
 * Aegis Graph — graph tests.
 *
 * NEW WORK for the Relate by Neo4j Hackathon (Contest Period Nov 11 – Dec 11,
 * 2026). Every test runs against an in-memory Relate store, seeded with the
 * demo history, so the numbers below are real query results, not claims.
 * The mandate engine's own 20 tests live in mandate.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeGraph, evaluateAndRecord, normalizeVendorName, openGraph, vendorSimilarity } from './graph';
import { ATLAS_1_MANDATE, ATLAS_2_MANDATE, ATLAS_2_RECENT, DEMO_MONTH, seedHistory } from './seed';
import { blastRadius, lookalikes, monthlySpend, splitGroup, vendorMonthly, whyBlocked } from './queries';

function freshSeeded() {
  const handle = openGraph(':memory:');
  seedHistory(handle.conn);
  return handle;
}

test('seed creates the demo history: 17 nodes, 17 relationships', () => {
  const { db, conn } = freshSeeded();
  try {
    assert.equal(Number(conn.query('MATCH (n) RETURN count(n) AS n').single().n), 17);
    assert.equal(Number(conn.query('MATCH ()-[r]->() RETURN count(r) AS n').single().n), 17);
  } finally {
    closeGraph({ db, conn });
  }
});

test('monthly spend is read from the graph: atlas-1 $800, atlas-2 $800', () => {
  const { db, conn } = freshSeeded();
  try {
    assert.equal(monthlySpend(conn, 'atlas-1', DEMO_MONTH), 800);
    assert.equal(monthlySpend(conn, 'atlas-2', DEMO_MONTH), 800);
    assert.equal(vendorMonthly(conn, 'atlas-1', 'vendor-acme-corp', DEMO_MONTH), 500);
    assert.equal(vendorMonthly(conn, 'atlas-1', 'vendor-globex', DEMO_MONTH), 300);
  } finally {
    closeGraph({ db, conn });
  }
});

test('$2,400 Acme payment is BLOCKED and the graph names both violated rules', () => {
  const { db, conn } = freshSeeded();
  try {
    const spent = monthlySpend(conn, 'atlas-1', DEMO_MONTH);
    const rec = evaluateAndRecord(
      conn,
      { ...ATLAS_1_MANDATE, spentThisMonthUsd: spent },
      'atlas-1',
      { issueKey: 'PROJ-123', vendor: 'Acme Corp', amountUsd: 2400 },
      'p3',
    );
    assert.equal(rec.verdict.decision, 'BLOCKED');
    const evidence = whyBlocked(conn, 'p3');
    assert.equal(evidence.verdict, 'BLOCKED');
    const rules = evidence.rules.map((r) => r.rule).sort();
    // The engine reports the split check too: $800 spent + $2,400 would
    // take the month to $3,200, so the same breach trips all three checks.
    assert.deepEqual(rules, ['monthly-cap', 'per-item-cap', 'split-payment']);
  } finally {
    closeGraph({ db, conn });
  }
});

test('"Acme Corp Ltd" is BLOCKED and the graph links it to Acme Corp as a lookalike', () => {
  const { db, conn } = freshSeeded();
  try {
    const spent = monthlySpend(conn, 'atlas-1', DEMO_MONTH);
    const rec = evaluateAndRecord(
      conn,
      { ...ATLAS_1_MANDATE, spentThisMonthUsd: spent },
      'atlas-1',
      { issueKey: 'PROJ-124', vendor: 'Acme Corp Ltd', amountUsd: 100 },
      'p6',
    );
    assert.equal(rec.verdict.decision, 'BLOCKED');
    assert.ok(rec.verdict.reasons.some((r) => r.includes('not approved')));
    const likes = lookalikes(conn, 'vendor-acme-corp-ltd');
    assert.equal(likes.length, 1);
    assert.equal(likes[0].name, 'Acme Corp');
    assert.equal(likes[0].similarity, 1);
  } finally {
    closeGraph({ db, conn });
  }
});

test('third $400 Globex payment is BLOCKED by the split-payment check alone', () => {
  const { db, conn } = freshSeeded();
  try {
    const rec = evaluateAndRecord(
      conn,
      ATLAS_2_MANDATE,
      'atlas-2',
      { issueKey: 'PROJ-203', vendor: 'Globex', amountUsd: 400 },
      'p7',
      { recentRequests: ATLAS_2_RECENT },
    );
    assert.equal(rec.verdict.decision, 'BLOCKED');
    const failed = rec.verdict.checks.filter((c) => !c.passed).map((c) => c.name);
    assert.deepEqual(failed, ['split-payment']);
    const split = splitGroup(conn, 'atlas-2', 'vendor-globex', DEMO_MONTH);
    assert.equal(split.count, 3);
    assert.equal(split.total, 1200);
  } finally {
    closeGraph({ db, conn });
  }
});

test('blast radius for Globex lists both agents with their totals', () => {
  const { db, conn } = freshSeeded();
  try {
    evaluateAndRecord(
      conn,
      ATLAS_2_MANDATE,
      'atlas-2',
      { issueKey: 'PROJ-203', vendor: 'Globex', amountUsd: 400 },
      'p7',
      { recentRequests: ATLAS_2_RECENT },
    );
    const radius = blastRadius(conn, 'vendor-globex');
    assert.equal(radius.length, 2);
    assert.equal(radius[0].agentId, 'atlas-2');
    assert.equal(radius[0].payments, 3);
    assert.equal(radius[0].total, 1200);
    assert.equal(radius[1].agentId, 'atlas-1');
    assert.equal(radius[1].payments, 1);
    assert.equal(radius[1].total, 300);
  } finally {
    closeGraph({ db, conn });
  }
});

test('vendor name normalization catches the spoof spellings', () => {
  assert.equal(normalizeVendorName('Acme Corp'), 'acme');
  assert.equal(normalizeVendorName('Acme Corp Ltd'), 'acme');
  assert.equal(normalizeVendorName('acme-corp.io'), 'acme');
  assert.equal(vendorSimilarity('Acme Corp Ltd', 'Acme Corp'), 1);
  assert.equal(vendorSimilarity('acme-corp.io', 'Acme Corp'), 1);
  assert.ok(vendorSimilarity('Globex', 'Acme Corp') < 0.6);
});
