/**
 * Aegis Graph — seed runner. Builds the committed persistent store
 * (data/graph.rl) from scratch: delete, open, seed, checkpoint.
 *
 * Run with `pnpm run seed`. The committed store holds the demo HISTORY
 * only (the $800 spent + atlas-2's two $400 payments). Live evaluations
 * happen in the demo, on a copy, so this file stays reproducible.
 */

import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { closeGraph, openGraph } from './graph';
import { seedHistory } from './seed';

// Compiled output lives in dist/, so the repo root is one level up.
const HERE = join(__dirname, '..');
const STORE = join(HERE, 'data', 'graph.rl');

function main(): void {
  if (existsSync(STORE)) rmSync(STORE);
  const { db, conn } = openGraph(STORE);
  try {
    seedHistory(conn);
    closeGraph({ db, conn });
    const nodes = Number(conn.query('MATCH (n) RETURN count(n) AS n').single().n);
    const rels = Number(conn.query('MATCH ()-[r]->() RETURN count(r) AS n').single().n);
    console.log(`seeded ${STORE}: ${nodes} nodes, ${rels} relationships, ${statSync(STORE).size} bytes`);
  } catch (err) {
    try {
      closeGraph({ db, conn });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

main();
