/**
 * Aegis Graph — demo seed data.
 *
 * NEW WORK for the Relate by Neo4j Hackathon (Contest Period Nov 11 – Dec 11,
 * 2026). The numbers are the Aegis worked example from the Codegeist
 * scaffold (the $2,400 Acme payment against a $1,000 monthly cap, $800
 * already spent), replayed here as graph data so the demo evaluates the
 * same story the mandate engine already proved.
 *
 * Month: 2026-11. All amounts USD.
 *
 * Agent atlas-1 — the headline demo.
 *   Mandate m1: $1,000/month, $500 per item, vendors Acme Corp, Globex,
 *   Initech. $800 already spent: $500 to Acme Corp (Nov 3) + $300 to
 *   Globex (Nov 8), both APPROVED and recorded.
 *   The demo then asks for $2,400 from Acme Corp (BLOCKED: per-item cap
 *   AND monthly cap) and $100 from "Acme Corp Ltd" (BLOCKED: not an
 *   approved vendor — a lookalike of Acme Corp).
 *
 * Agent atlas-2 — the split-payment demo.
 *   Mandate m2: $1,000/month, $500 per item, vendor Globex. Its mandate
 *   snapshot says $0 spent — but the graph already holds two $400
 *   Globex payments (Nov 10, Nov 12), recorded in the ledger and not
 *   yet rolled into the mandate's spent total. That stale snapshot is
 *   exactly the condition the split-payment check exists for.
 *   The demo then asks for a third $400 from Globex: the flat checks
 *   pass ($400 fits the per-item cap, $0 + $400 fits the monthly cap),
 *   but the graph pattern — three payments, one vendor, one month,
 *   $1,200 total — trips the split-payment check and BLOCKS it.
 */

import type { Connection } from '@relate/relate';

export const DEMO_MONTH = '2026-11';

export const ATLAS_1_MANDATE = {
  id: 'm1',
  name: 'Atlas-1 team mandate',
  monthlyCapUsd: 1000,
  perItemCapUsd: 500,
  approvedVendors: ['Acme Corp', 'Globex', 'Initech'],
  monthKey: DEMO_MONTH,
  spentThisMonthUsd: 800,
};

export const ATLAS_2_MANDATE = {
  id: 'm2',
  name: 'Atlas-2 team mandate',
  monthlyCapUsd: 1000,
  perItemCapUsd: 500,
  approvedVendors: ['Globex'],
  monthKey: DEMO_MONTH,
  spentThisMonthUsd: 0,
};

/** The two $400 Globex payments already in atlas-2's ledger (Nov 10, Nov 12). */
export const ATLAS_2_RECENT = [
  { issueKey: 'PROJ-201', vendor: 'Globex', amountUsd: 400, requestedAt: '2026-11-10T10:00:00Z' },
  { issueKey: 'PROJ-202', vendor: 'Globex', amountUsd: 400, requestedAt: '2026-11-12T10:00:00Z' },
];

const SEED_STATEMENTS: string[] = [
  // Agents, mandates, vendors.
  `CREATE (a1:Agent {id: 'atlas-1', name: 'Atlas-1 demo agent'})
   CREATE (a2:Agent {id: 'atlas-2', name: 'Atlas-2 demo agent'})
   CREATE (m1:Mandate {id: 'm1', name: 'Atlas-1 team mandate', monthlyCapUsd: 1000, perItemCapUsd: 500, month: '2026-11'})
   CREATE (m2:Mandate {id: 'm2', name: 'Atlas-2 team mandate', monthlyCapUsd: 1000, perItemCapUsd: 500, month: '2026-11'})
   CREATE (vAcme:Vendor {id: 'vendor-acme-corp', name: 'Acme Corp'})
   CREATE (vGlobex:Vendor {id: 'vendor-globex', name: 'Globex'})
   CREATE (vInitech:Vendor {id: 'vendor-initech', name: 'Initech'})
   CREATE (vLtd:Vendor {id: 'vendor-acme-corp-ltd', name: 'Acme Corp Ltd'})
   CREATE (vIo:Vendor {id: 'vendor-acme-corp-io', name: 'acme-corp.io'})
   CREATE (a1)-[:GOVERNED_BY]->(m1)
   CREATE (a2)-[:GOVERNED_BY]->(m2)
   CREATE (vLtd)-[:LOOKALIKE {similarity: 1.0}]->(vAcme)
   CREATE (vIo)-[:LOOKALIKE {similarity: 1.0}]->(vAcme)`,
  // atlas-1 history: $500 Acme (Nov 3) + $300 Globex (Nov 8) = $800 spent.
  `MATCH (a1:Agent {id: 'atlas-1'}), (vAcme:Vendor {id: 'vendor-acme-corp'}), (vGlobex:Vendor {id: 'vendor-globex'})
   CREATE (p1:Payment {id: 'p1', issueKey: 'PROJ-101', amount: 500, currency: 'USD', month: '2026-11', status: 'APPROVED'})
   CREATE (d1:Decision {id: 'd-p1', verdict: 'APPROVED', at: '2026-11-03T10:00:00Z'})
   CREATE (a1)-[:REQUESTED {at: '2026-11-03T10:00:00Z'}]->(p1)
   CREATE (p1)-[:TO]->(vAcme)
   CREATE (p1)-[:DECIDED_BY]->(d1)
   CREATE (p2:Payment {id: 'p2', issueKey: 'PROJ-102', amount: 300, currency: 'USD', month: '2026-11', status: 'APPROVED'})
   CREATE (d2:Decision {id: 'd-p2', verdict: 'APPROVED', at: '2026-11-08T10:00:00Z'})
   CREATE (a1)-[:REQUESTED {at: '2026-11-08T10:00:00Z'}]->(p2)
   CREATE (p2)-[:TO]->(vGlobex)
   CREATE (p2)-[:DECIDED_BY]->(d2)`,
  // atlas-2 history: two $400 Globex payments (Nov 10, Nov 12), in the
  // ledger but not yet in mandate m2's spent snapshot ($0).
  `MATCH (a2:Agent {id: 'atlas-2'}), (vGlobex:Vendor {id: 'vendor-globex'})
   CREATE (p4:Payment {id: 'p4', issueKey: 'PROJ-201', amount: 400, currency: 'USD', month: '2026-11', status: 'APPROVED'})
   CREATE (d4:Decision {id: 'd-p4', verdict: 'APPROVED', at: '2026-11-10T10:00:00Z'})
   CREATE (a2)-[:REQUESTED {at: '2026-11-10T10:00:00Z'}]->(p4)
   CREATE (p4)-[:TO]->(vGlobex)
   CREATE (p4)-[:DECIDED_BY]->(d4)
   CREATE (p5:Payment {id: 'p5', issueKey: 'PROJ-202', amount: 400, currency: 'USD', month: '2026-11', status: 'APPROVED'})
   CREATE (d5:Decision {id: 'd-p5', verdict: 'APPROVED', at: '2026-11-12T10:00:00Z'})
   CREATE (a2)-[:REQUESTED {at: '2026-11-12T10:00:00Z'}]->(p5)
   CREATE (p5)-[:TO]->(vGlobex)
   CREATE (p5)-[:DECIDED_BY]->(d5)
   CREATE (p4)-[:SPLIT_WITH]->(p5)`,
];

/** Seed the demo history into an empty graph. Runs in one transaction. */
export function seedHistory(conn: Connection): void {
  const count = conn.query('MATCH (n) RETURN count(n) AS n').single().n as number;
  if (count > 0) {
    throw new Error(`seedHistory refuses a non-empty graph (${count} nodes already present)`);
  }
  conn.begin();
  try {
    for (const stmt of SEED_STATEMENTS) {
      conn.query(stmt);
    }
    conn.commit();
  } catch (err) {
    conn.rollback();
    throw err;
  }
}
