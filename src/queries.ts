/**
 * Aegis Graph — the queries that make the graph worth having.
 *
 * NEW WORK for the Relate by Neo4j Hackathon (Contest Period Nov 11 – Dec 11,
 * 2026). Each function is one question a flat audit log cannot answer
 * without a re-scan — here it is a traversal.
 */

import type { Connection } from '@relate/relate';

/** Why was this payment blocked? Follow DECIDED_BY, then VIOLATES. */
export function whyBlocked(
  conn: Connection,
  paymentId: string,
): { verdict: string; rules: { rule: string; detail: string }[] } {
  const res = conn.query(
    `MATCH (p:Payment {id: $paymentId})-[:DECIDED_BY]->(d:Decision)
     OPTIONAL MATCH (d)-[v:VIOLATES]->(m:Mandate)
     RETURN d.verdict AS verdict, v.rule AS rule, v.detail AS detail`,
    { paymentId },
  );
  const rows = res.rows;
  if (rows.length === 0) throw new Error(`no payment with id ${paymentId}`);
  const verdict = String(rows[0].verdict);
  const rules = rows
    .filter((r) => r.rule !== null)
    .map((r) => ({ rule: String(r.rule), detail: String(r.detail) }));
  return { verdict, rules };
}

/** Total APPROVED spend by one agent in one month (YYYY-MM). */
export function monthlySpend(conn: Connection, agentId: string, month: string): number {
  const row = conn.query(
    `MATCH (a:Agent {id: $agentId})-[:REQUESTED]->(p:Payment {month: $month})-[:DECIDED_BY]->(d:Decision {verdict: 'APPROVED'})
     RETURN sum(p.amount) AS total`,
    { agentId, month },
  ).single();
  return Number(row.total ?? 0);
}

/** APPROVED spend by one agent with one vendor in one month. */
export function vendorMonthly(
  conn: Connection,
  agentId: string,
  vendorId: string,
  month: string,
): number {
  const row = conn.query(
    `MATCH (a:Agent {id: $agentId})-[:REQUESTED]->(p:Payment {month: $month})-[:TO]->(v:Vendor {id: $vendorId}),
           (p)-[:DECIDED_BY]->(d:Decision {verdict: 'APPROVED'})
     RETURN sum(p.amount) AS total`,
    { agentId, vendorId, month },
  ).single();
  return Number(row.total ?? 0);
}

/**
 * Split-payment pattern for one agent and one vendor in one month: every
 * payment, with the count and the total. The guard flags it when the
 * total breaks the monthly cap while each payment alone fits the
 * per-item cap — the shape of a payment split to dodge the cap.
 */
export function splitGroup(
  conn: Connection,
  agentId: string,
  vendorId: string,
  month: string,
): { payments: { id: string; amount: number }[]; count: number; total: number } {
  const res = conn.query(
    `MATCH (a:Agent {id: $agentId})-[:REQUESTED]->(p:Payment {month: $month})-[:TO]->(v:Vendor {id: $vendorId})
     RETURN p.id AS id, p.amount AS amount ORDER BY p.amount`,
    { agentId, vendorId, month },
  );
  const payments = res.rows.map((r) => ({ id: String(r.id), amount: Number(r.amount) }));
  return { payments, count: payments.length, total: payments.reduce((s, p) => s + p.amount, 0) };
}

/** Vendors flagged as lookalikes of this vendor, with similarity scores. */
export function lookalikes(
  conn: Connection,
  vendorId: string,
): { id: string; name: string; similarity: number }[] {
  const res = conn.query(
    `MATCH (v:Vendor {id: $vendorId})-[r:LOOKALIKE]->(o:Vendor)
     RETURN o.id AS id, o.name AS name, r.similarity AS similarity`,
    { vendorId },
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    similarity: Number(row.similarity),
  }));
}

/**
 * Blast radius: every agent that paid this vendor, with how many payments
 * and how much. If a vendor turns out compromised, this is the list of
 * agents to freeze first.
 */
export function blastRadius(
  conn: Connection,
  vendorId: string,
): { agentId: string; agentName: string; payments: number; total: number }[] {
  const res = conn.query(
    `MATCH (a:Agent)-[:REQUESTED]->(p:Payment)-[:TO]->(v:Vendor {id: $vendorId})
     RETURN a.id AS agentId, a.name AS agentName, count(p) AS payments, sum(p.amount) AS total
     ORDER BY total DESC`,
    { vendorId },
  );
  return res.rows.map((row) => ({
    agentId: String(row.agentId),
    agentName: String(row.agentName),
    payments: Number(row.payments),
    total: Number(row.total),
  }));
}
