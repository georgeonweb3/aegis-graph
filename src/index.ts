/**
 * Aegis Graph — demo runner.
 *
 * NEW WORK for the Relate by Neo4j Hackathon (Contest Period Nov 11 – Dec 11,
 * 2026). Run with `pnpm run demo`.
 *
 * The demo works on a COPY of data/graph.rl in the OS temp dir, so the
 * committed store stays pristine and every run is reproducible. It:
 *   1. loads the seeded history (two agents, $800 spent, two $400 Globex
 *      payments sitting in atlas-2's ledger),
 *   2. evaluates three live requests through the mandate engine,
 *   3. records each payment + decision in the graph, in one transaction,
 *   4. prints the verdicts AND the graph evidence behind each one.
 *
 * The three requests:
 *   A. atlas-1 pays Acme Corp $2,400 — BLOCKED (per-item cap + monthly cap).
 *   B. atlas-1 pays "Acme Corp Ltd" $100 — BLOCKED (not an approved
 *      vendor; the graph shows it is a lookalike of Acme Corp).
 *   C. atlas-2 pays Globex $400 — BLOCKED by the split-payment check.
 *      The flat checks pass, but the graph holds two $400 Globex payments
 *      already, and three × $400 = $1,200 against a $1,000 monthly cap.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeGraph, evaluateAndRecord, openGraph } from './graph';
import { ATLAS_1_MANDATE, ATLAS_2_MANDATE, ATLAS_2_RECENT, DEMO_MONTH } from './seed';
import { blastRadius, lookalikes, monthlySpend, splitGroup, whyBlocked } from './queries';

// Compiled output lives in dist/, so the repo root is one level up.
const HERE = join(__dirname, '..');
const STORE = join(HERE, 'data', 'graph.rl');

function main(): void {
  if (!existsSync(STORE)) {
    throw new Error(`committed store not found at ${STORE} — run "pnpm run seed" first`);
  }
  const demoPath = join(tmpdir(), `aegis-graph-demo-${process.pid}.rl`);
  copyFileSync(STORE, demoPath);
  const { db, conn } = openGraph(demoPath);
  try {
    const nodes = Number(conn.query('MATCH (n) RETURN count(n) AS n').single().n);
    console.log(`Aegis Graph demo — Relate store ${demoPath} (${nodes} nodes seeded)\n`);

    // atlas-1's spent total comes from the graph itself, not a snapshot.
    const spentAtlas1 = monthlySpend(conn, 'atlas-1', DEMO_MONTH);
    console.log(`atlas-1: $${spentAtlas1} approved spend in ${DEMO_MONTH} (mandate cap $1,000/mo, $500/item)\n`);

    // A. The $2,400 Acme payment.
    const a = evaluateAndRecord(
      conn,
      { ...ATLAS_1_MANDATE, spentThisMonthUsd: spentAtlas1 },
      'atlas-1',
      { issueKey: 'PROJ-123', vendor: 'Acme Corp', amountUsd: 2400, description: 'Annual license' },
      'p3',
    );
    console.log(`A. atlas-1 → Acme Corp $2,400: ${a.verdict.decision}`);
    for (const reason of a.verdict.reasons) console.log(`   - ${reason}`);
    const evidenceA = whyBlocked(conn, 'p3');
    console.log(`   graph: Decision ${a.decisionId} VIOLATES: ${evidenceA.rules.map((r) => r.rule).join(', ')}`);

    // B. The lookalike vendor.
    const b = evaluateAndRecord(
      conn,
      { ...ATLAS_1_MANDATE, spentThisMonthUsd: spentAtlas1 },
      'atlas-1',
      { issueKey: 'PROJ-124', vendor: 'Acme Corp Ltd', amountUsd: 100 },
      'p6',
    );
    console.log(`\nB. atlas-1 → "Acme Corp Ltd" $100: ${b.verdict.decision}`);
    for (const reason of b.verdict.reasons) console.log(`   - ${reason}`);
    const likes = lookalikes(conn, 'vendor-acme-corp-ltd');
    for (const l of likes) {
      console.log(`   graph: "Acme Corp Ltd" -[:LOOKALIKE {similarity: ${l.similarity}}]-> ${l.name}`);
    }

    // C. The split-payment catch. atlas-2's mandate snapshot says $0 spent,
    // but the graph holds two $400 Globex payments — the stale snapshot is
    // the condition the split check exists for.
    const c = evaluateAndRecord(
      conn,
      ATLAS_2_MANDATE,
      'atlas-2',
      { issueKey: 'PROJ-203', vendor: 'Globex', amountUsd: 400 },
      'p7',
      { recentRequests: ATLAS_2_RECENT },
    );
    console.log(`\nC. atlas-2 → Globex $400 (third this month): ${c.verdict.decision}`);
    for (const reason of c.verdict.reasons) console.log(`   - ${reason}`);
    const split = splitGroup(conn, 'atlas-2', 'vendor-globex', DEMO_MONTH);
    console.log(
      `   graph: atlas-2 made ${split.count} Globex payments in ${DEMO_MONTH} totalling $${split.total} ` +
        `(${split.payments.map((p) => `${p.id}: $${p.amount}`).join(', ')})`,
    );

    // Blast radius: who touched Globex.
    console.log(`\nBlast radius for Globex (who to freeze if the vendor is compromised):`);
    for (const row of blastRadius(conn, 'vendor-globex')) {
      console.log(`   - ${row.agentName} (${row.agentId}): ${row.payments} payments, $${row.total}`);
    }

    console.log(`\nDemo store (query it with the CLI): ${demoPath}`);
    console.log(`MCP for agents: relate serve --mcp stdio --database ${demoPath} --read-only`);
  } finally {
    closeGraph({ db, conn });
  }
}

main();
