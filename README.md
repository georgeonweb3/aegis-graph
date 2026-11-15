# Aegis Graph — the spend guard that shows its work

**The only entry where a blocked payment comes with the exact path that blocked it.**

AI agents spend money. Aegis enforces a human-set spending mandate on
every agent payment — per-item cap, monthly cap, approved vendors — and
every decision is stored as a Relate graph, so when a payment is blocked
the graph answers WHY by traversal, not by re-reading logs. Split-payment
evasion and lookalike vendors are graph patterns, not rows to grep for.

- Hackathon: [Relate by Neo4j Hackathon](https://relate.devpost.com/rules) — 3 non-cash prizes (Mac Studio $3,799 / Mac mini $1,499 / Mac mini $899)
- Closes: **Fri Dec 11, 2026, 6:00 PM PST (Sat Dec 12, 03:00 WAT)**. Judging Dec 12–16. Winners announced Thu Dec 17, 2026.
- Category: open — "Context, connected": show how connected data helps agents find and use the relationships that matter.

## Use case

An agent that spends needs a guard, and a guard that only says "no" is
not enough — the human who set the mandate needs to see the reason, and
the agent needs to learn from it. Today that evidence lives in flat logs:
to find why a payment was blocked you re-read lines; to find split
payments you write a script; to spot a spoofed vendor you eyeball names.

Aegis Graph makes the audit ledger a graph. Agents, vendors, payments,
mandates, decisions and budgets are nodes; the relationships are the
evidence. A blocked payment is a path you can walk: Payment
→ DECIDED_BY → Decision → VIOLATES → Mandate, with the rule name and
the numbers on the edge. Three small payments to one vendor are a
SPLIT_WITH pattern. A vendor one edit away from an approved name is a
LOOKALIKE edge. A compromised vendor's blast radius is one query.

Who benefits: anyone running agents that spend — the same teams Aegis
already guards on-chain, now with the reasoning visible in the graph.

## How it uses Relate

- Mode: **single file** (`data/graph.rl`, 40 KB). Why: the submission
  checklist requires a persistent store judges can inspect, and a single
  file is the whole ledger — clone the repo, and the graph is already
  there. In-memory stores are used only by the tests.
- What the graph models:
  - `(Agent)-[:REQUESTED]->(Payment)-[:TO]->(Vendor)`
  - `(Payment)-[:DECIDED_BY]->(Decision)-[:VIOLATES {rule, detail}]->(Mandate)`
  - `(Agent)-[:GOVERNED_BY]->(Mandate)`, `(Payment)-[:COUNTS_TOWARD]->(Budget)`
  - `(Payment)-[:SPLIT_WITH]->(Payment)` — same vendor, same month
  - `(Vendor)-[:LOOKALIKE {similarity}]->(Vendor)` — spoofed names
- Relate capabilities used: embedded engine (no server), Cypher queries
  with bound parameters, explicit transactions (verdict + evidence commit
  together, so they can never drift apart), and the MCP server
  (`relate serve --mcp stdio`) so a third-party agent can ask the graph
  the same questions the demo answers.

## Setup and run

No account, no card, no server. Relate is open source (Apache 2.0) and
embedded — it runs as a library inside the app. The only install is the
CLI (signature-verified by its own install script) and the Node package.

```bash
# 1. Relate CLI (optional, for inspecting the store + the MCP server)
curl -sSfL https://relatedb.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
relate --version   # Relate v1.0.1

# 2. Project
pnpm install
pnpm test          # 27 tests — 20 mandate + 7 graph, all passing (2026-11-15)
pnpm run demo      # the three blocked payments + the graph evidence
pnpm run seed      # rebuild data/graph.rl from scratch (history only)
```

The demo works on a COPY of `data/graph.rl` in the OS temp dir, so the
committed store stays pristine and every run is reproducible. It prints
the copy's path so you can query it afterwards:

```bash
relate --database ./data/graph.rl --read-only --mode table \
  "MATCH (a:Agent)-[:REQUESTED]->(p:Payment) RETURN a.id AS agent, p.id AS payment, p.amount AS amount ORDER BY p.id"
```

MCP for agents (read-only):

```bash
relate serve --mcp stdio --database ./data/graph.rl --read-only
```

## Where the data lives

`data/graph.rl` — the persistent Relate store, committed to the repo.
Seeded history (17 nodes, 17 relationships): two demo agents, their
mandates, five vendors, four APPROVED payments ($800 spent across both
agents). Live evaluations from `pnpm run demo` are recorded in the demo
copy, not in this file.

## Step 0 — why this wins

**Win thesis.** Every other spend-guard demo shows a verdict. This one
shows the verdict *and the path that produced it*, in a graph the judge
can query. The mandate engine is not a demo rule: it is Aegis, a
spend-control layer already proven on-chain (ERC-8004 agent identity,
real mainnet and testnet transactions, a merged public PR answering a
real question), now with its reasoning stored as connected data.

**The most memorable moment.** The Rovo-style agent is asked to approve
a $2,400 vendor payment. Aegis blocks it in the graph, and the demo
prints the exact arithmetic — $2,400 is $1,900 over the per-item cap
and would take the month to $3,200 — then the same question is asked
of the graph through MCP by a third-party agent, and it gets the same
answer. The number the judge remembers: **$2,400 blocked, with the
path to prove it**.

## Worked example

Agent atlas-1, mandate $1,000/month, $500 per item, vendors Acme Corp
and Globex, $800 already spent this month.

Request: "Pay Acme Corp $2,400 for the annual license."

Aegis Graph: 🔴 **BLOCKED.** $2,400 exceeds the $500 per-item cap by
$1,900, and it would take monthly spend to $3,200, $2,200 over the
$1,000 monthly cap. The graph records Decision `d-p3` with VIOLATES
edges to the mandate for `per-item-cap`, `monthly-cap` and
`split-payment`. Two ways forward: a human raises the mandate, or the
payment is renegotiated. Splitting it to dodge the cap is itself a
breach — the split-payment check catches that, and the graph shows the
SPLIT_WITH pattern.

Second example, same demo: "Acme Corp Ltd" asks for $100. BLOCKED —
not an approved vendor. The graph already holds
`Acme Corp Ltd -[:LOOKALIKE {similarity: 1.0}]-> Acme Corp`: same name
after normalization, different legal entity. That is the spoof, visible.

Third example: atlas-2 asks Globex for $400, a third time this month.
The flat checks pass — $400 fits the per-item cap, and the mandate
snapshot says $0 spent. But the graph holds two $400 Globex payments
already, and three × $400 = $1,200 against a $1,000 cap. BLOCKED by
the split-payment check alone.

## Quantified proof

- Mandate engine: **20/20 tests pass** (`src/mandate.test.ts`),
  covering per-item and monthly caps, vendor allow-list spoofing
  (lookalikes like `Acme Corp Ltd` and `acme-corp.io` are blocked),
  split-payment evasion, boundary values, invalid amounts, text parsing.
- Graph layer: **7/7 tests pass** (`src/graph.test.ts`), against a real
  in-memory Relate store: seed counts (17 nodes, 17 relationships),
  monthly spend read from the graph ($800 per agent), the $2,400 block
  with all three violated rules named, the lookalike link, the
  split-payment block alone, the blast radius, and name normalization.
- Total: **27/27 tests pass** (`pnpm test`, 2026-11-15). The engine is
  pure TypeScript with no Relate dependency, so its tests run anywhere;
  the same file is what the graph layer calls.

## What is built (this scaffold)

- `src/mandate.ts` — the deterministic mandate engine (six checks).
  Reused from George's own Aegis-for-Jira Codegeist scaffold (MIT) —
  see the reuse disclosure below.
- `src/graph.ts` — Relate wrapper: open/checkpoint, vendor-name
  normalization + similarity, `evaluateAndRecord` (verdict + evidence
  in one transaction).
- `src/seed.ts` — the demo scenario: two agents, two mandates, five
  vendors, four APPROVED payments.
- `src/queries.ts` — `whyBlocked`, `monthlySpend`, `vendorMonthly`,
  `splitGroup`, `lookalikes`, `blastRadius`.
- `src/index.ts` — the demo runner (three blocked payments + evidence).
- `src/seed-runner.ts` — rebuilds `data/graph.rl` from scratch.
- `data/graph.rl` — the persistent store, committed (17 nodes, 17 rels).

## Reuse disclosure (Official Rules §3)

The mandate engine (`src/mandate.ts`) and its 20 tests are George
Agbe's own earlier code, copied from his Aegis-for-Jira Codegeist 2026
scaffold (MIT, github.com/georgeonweb3/aegis-for-jira), and disclosed
here and in the file headers. The rules allow reusing your own earlier
code with disclosure, and only work done during the Contest Period is
judged. The new work in this repo — the graph layer, the seed scenario,
the queries, the demo, the MCP wiring and the docs — was all built
Nov 15, 2026, inside the Contest Period (Nov 11 – Dec 11, 2026).
AI-assisted development: the scaffold was built with Muse (Meta's agent)
under George's direction; the engine's tests are the verification.

## Week-by-week plan (Nov 16 – Dec 11)

- **Week 1 (Nov 16–22): setup + skeleton. DONE in this scaffold except
  George's steps below.** Relate CLI installed and verified (v1.0.1,
  signature-checked), Node client installed, mandate engine tested,
  graph schema + seed + queries + demo working, MCP handshake verified.
  George's steps this week: Devpost join, GitHub repo + `relate` tag.
- **Week 2 (Nov 23–29): core agent.** Live MCP test from a real
  third-party client (Claude Desktop / MCP Inspector) asking the graph
  the demo questions; judge-flow test from a fresh clone (install →
  test → demo with no help); fix whatever install friction shows up.
- **Week 3 (Nov 30–Dec 6): polish.** Second demo scenario (a second
  month, showing the monthly rollover), a graph export (nodes/edges
  JSON) for the video, README final, screenshots of the graph.
- **Week 4 (Dec 7–11): demo + submit.** 1–2 min demo video (the
  $2,400 block is the opening shot), submission text, submit early —
  Dec 10, not Dec 11 — Devpost slows down near deadlines.

## George's steps (only you can do these)

1. **Devpost:** free account if needed, click Join Hackathon at
   https://relate.devpost.com.
2. **GitHub repo:** create the public repo (the connector cannot create
   repos) and push this directory. Add the topic **`relate`** (required
   — submissions without it may be treated as incomplete) and
   **`relate-neo4j-hackathon`** (recommended). Keep it public with the
   tag through judging and the winner announcement (Dec 17).
3. **Demo video (Week 4):** 1–2 minutes, screen share is fine, the
   $2,400 block first. Your own filming/editing; no login or payment
   to view it.
4. **Submit by Dec 11, 6:00 PM PST (Dec 12, 03:00 WAT):** Devpost
   form, repo link, video link, description, and the statement of
   which Relate capabilities, third-party tools and AI tools the
   project uses. Your click.
5. **No Neo4j account needed.** Relate is open source and embedded —
   no signup, no server, no AuraDB, no card. If anyone asks for a
   Neo4j account for this entry, that is a different product.

## Local verification (no account needed)

```bash
pnpm install
pnpm test    # tsc strict compile clean, 27/27 tests pass (2026-11-15)
pnpm run demo   # three blocked payments + graph evidence, on a temp copy
pnpm run seed   # rebuild data/graph.rl (17 nodes, 17 rels, 40,960 bytes)
```

**Verification status (2026-11-15, this VM):** Relate CLI **v1.0.1**
installed via the official `install.sh` (release signature + SHA-256
verified, `relate-linux-amd64: OK`). `@relate/relate` **1.0.1**
installed via pnpm. CLI smoke test passed (CREATE + MATCH with
relationship properties, envelope JSON + table output, single-file
store). MCP server verified: `relate serve --mcp stdio` answers the
initialize handshake (`relate-mcp` v1.0.1). Committed store verified
by direct CLI query (4 payments, correct amounts). `tsc` compiles
clean under `strict`; 27/27 tests pass.

**Eligibility (Official Rules §2, verified 2026-11-15):** 18+,
located where the contest is allowed by law; excluded only if in a
U.S.-embargoed/sanctioned country or on a U.S. restricted-party list.
Nigeria is not U.S.-embargoed — George is eligible. Prizes are
hardware, shipped at Neo4j's cost; the winner pays import duties,
taxes and customs, and provides tax documentation.

**Judging (Official Rules §5):** three winners, judged on Creativity,
Usefulness, Completeness, Clarity, and Effective use of connected
context, weighted equally per the rules. (The Devpost page shows
point weights of 30/25/20/15/10 for the same five criteria; the
Official Rules control where they conflict, and the rules say equal
weight.)

**VM quirks (this machine only, not the repo):** none hit during this
build. `pnpm` lives at `~/workspace/tools/pnpm` (add it to PATH);
the Relate CLI lives at `~/.local/bin/relate` (add it to PATH).

## Why this is not a wrapper

The agent does not ask an LLM whether a payment looks okay. It calls
a deterministic engine with six checks, and the graph stores the
verdict and its evidence together. The same checks answer over MCP, so
a third-party agent gets the same answer the demo gets. The mandate is
set by a human, and the one tool that changes it is never exposed over
MCP. The graph is the point: connected context is the product.
