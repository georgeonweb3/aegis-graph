/**
 * Aegis Graph — Relate graph layer.
 *
 * NEW WORK for the Relate by Neo4j Hackathon (Contest Period Nov 11 – Dec 11,
 * 2026). The spend-guard rules themselves come from the Aegis mandate engine
 * (mandate.ts, George's own earlier code, disclosed reuse — see its header).
 * Everything in this file is new: the graph model, the seed scenario, the
 * queries, and the record-the-decision flow.
 *
 * The graph is the audit ledger. A flat log can tell you a payment was
 * blocked; the graph tells you WHY, by traversal:
 *
 *   (Agent)-[:REQUESTED]->(Payment)-[:TO]->(Vendor)
 *   (Payment)-[:DECIDED_BY]->(Decision)-[:VIOLATES {rule}]->(Mandate)
 *   (Agent)-[:GOVERNED_BY]->(Mandate)
 *   (Payment)-[:COUNTS_TOWARD]->(Budget)
 *   (Payment)-[:SPLIT_WITH]->(Payment)        same vendor, same month
 *   (Vendor)-[:LOOKALIKE {similarity}]->(Vendor)
 *
 * A blocked payment is never a dead end: follow DECIDED_BY, then VIOLATES,
 * and you land on the exact mandate rule that fired, with the numbers.
 * Split-payment evasion and lookalike vendors are graph patterns — several
 * small payments to one vendor, or a vendor whose name is one edit away
 * from an approved one — not rows to grep for.
 */

import { Database, type Connection } from '@relate/relate';
import { checkSpend, type Mandate, type SpendRequest, type Verdict } from './mandate';

export interface GraphHandle {
  db: Database;
  conn: Connection;
}

/** Open a Relate store: a `.rl` file path, a directory, or `":memory:"`. */
export function openGraph(path: string): GraphHandle {
  const db = Database.open(path);
  const conn = db.connect();
  return { db, conn };
}

/** Flush to disk. Call before exiting so the `.rl` file holds the latest state. */
export function closeGraph(handle: GraphHandle): void {
  handle.db.checkpoint();
}

/** A payment the demo evaluates, plus where it lands in the graph. */
export interface RecordedEvaluation {
  paymentId: string;
  decisionId: string;
  verdict: Verdict;
}

/**
 * Normalize a vendor name for lookalike detection: lowercase, strip
 * punctuation and spaces, drop common legal/form suffixes (ltd, inc,
 * corp, co, io, com). "Acme Corp Ltd" and "acme-corp.io" both normalize
 * to "acmecorp" — the same as "Acme Corp".
 */
export function normalizeVendorName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Strip legal/form suffixes repeatedly: "acmecorpltd" -> "acmecorp" -> "acme".
  let prev = '';
  while (prev !== n) {
    prev = n;
    n = n.replace(/(ltd|inc|corp|co|llc|io|com)$/, '');
  }
  return n;
}

/** Stable vendor node id from the literal name (distinct per spelling). */
export function vendorIdFor(name: string): string {
  return `vendor-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** Similarity between two vendor names: 1.0 = same after normalization. */
export function vendorSimilarity(a: string, b: string): number {
  const na = normalizeVendorName(a);
  const nb = normalizeVendorName(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  // Levenshtein distance, normalized.
  const d: number[][] = Array.from({ length: na.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= nb.length; j++) d[0][j] = j;
  for (let i = 1; i <= na.length; i++) {
    for (let j = 1; j <= nb.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (na[i - 1] === nb[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - d[na.length][nb.length] / Math.max(na.length, nb.length);
}

export interface EvaluateOptions {
  /** Requests already in the ledger this month, not yet in the mandate's spent total. */
  recentRequests?: SpendRequest[];
  /** ISO timestamp for the decision node. Defaults to now. */
  at?: string;
}

/**
 * Evaluate one spend request against a mandate with the deterministic
 * engine, then record the payment AND the decision in the graph, in one
 * transaction — so the verdict and its evidence can never drift apart.
 *
 * - The Payment node links to its Agent, its Vendor and its Decision.
 * - A BLOCKED decision gets one VIOLATES edge per failed check, each
 *   carrying the rule name and the engine's detail text.
 * - A request whose vendor normalizes to an approved vendor but does not
 *   match it exactly gets a LOOKALIKE edge to the approved vendor,
 *   with the similarity score. That is the spoof, visible in the graph.
 * - A request that fails the split-payment check gets SPLIT_WITH edges
 *   to the other requests from the same vendor this month.
 */
export function evaluateAndRecord(
  conn: Connection,
  mandate: Mandate,
  agentId: string,
  request: SpendRequest,
  paymentId: string,
  opts: EvaluateOptions = {},
): RecordedEvaluation {
  const verdict = checkSpend(mandate, request, opts.recentRequests ?? []);
  const decisionId = `d-${paymentId}`;
  const at = opts.at ?? new Date().toISOString();
  const failedRules = verdict.checks.filter((c) => !c.passed);

  conn.begin();
  try {
    conn.query(
      `MERGE (a:Agent {id: $agentId})
       MERGE (v:Vendor {id: $vendorId, name: $vendor})
       MERGE (m:Mandate {id: $mandateId})
       CREATE (p:Payment {id: $paymentId, issueKey: $issueKey, amount: $amount, currency: 'USD', month: $month, status: $status})
       CREATE (d:Decision {id: $decisionId, verdict: $verdict, at: $at})
       CREATE (a)-[:REQUESTED {at: $at}]->(p)
       CREATE (p)-[:TO]->(v)
       CREATE (p)-[:DECIDED_BY]->(d)
       CREATE (a)-[:GOVERNED_BY]->(m)`,
      {
        agentId,
        vendorId: vendorIdFor(request.vendor),
        vendor: request.vendor,
        mandateId: mandate.id,
        paymentId,
        issueKey: request.issueKey,
        amount: request.amountUsd,
        month: mandate.monthKey,
        status: verdict.decision === 'APPROVED' ? 'APPROVED' : verdict.decision,
        decisionId,
        verdict: verdict.decision,
        at,
      },
    );

    for (const check of failedRules) {
      conn.query(
        `MATCH (d:Decision {id: $decisionId}), (m:Mandate {id: $mandateId})
         CREATE (d)-[:VIOLATES {rule: $rule, detail: $detail}]->(m)`,
        { decisionId, mandateId: mandate.id, rule: check.name, detail: check.detail },
      );
    }

    // Lookalike: vendor not approved, but normalizes close to an approved one.
    if (!verdict.checks.find((c) => c.name === 'vendor-approved')?.passed) {
      for (const approved of mandate.approvedVendors) {
        const sim = vendorSimilarity(request.vendor, approved);
        if (sim >= 0.6) {
          conn.query(
            `MATCH (v:Vendor {id: $vendorId})
             MERGE (o:Vendor {id: $approvedId, name: $approved})
             MERGE (v)-[:LOOKALIKE {similarity: $sim}]->(o)`,
            {
              vendorId: vendorIdFor(request.vendor),
              approvedId: vendorIdFor(approved),
              approved,
              sim: Math.round(sim * 100) / 100,
            },
          );
        }
      }
    }

    // Split-payment: link to the other requests from the same vendor.
    if (!verdict.checks.find((c) => c.name === 'split-payment')?.passed) {
      for (const other of opts.recentRequests ?? []) {
        conn.query(
          `MATCH (p:Payment {id: $paymentId}), (o:Payment {issueKey: $otherKey})
           MERGE (p)-[:SPLIT_WITH]->(o)`,
          { paymentId, otherKey: other.issueKey },
        );
      }
    }

    conn.commit();
  } catch (err) {
    conn.rollback();
    throw err;
  }

  return { paymentId, decisionId, verdict };
}
