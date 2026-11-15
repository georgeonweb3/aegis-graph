# Aegis Graph — Relate by Neo4j Hackathon status

Updated: 2026-11-15 (after scaffold verification + repo publish)

## Verified (2026-11-15)
- Tests: **27/27 pass** (`npm test` — mandate + graph suites, 0 fail)
- Demo: runs end to end (`npm run demo`) — all three blocks fire:
  A. atlas-1 → Acme Corp $2,400 BLOCKED (per-item cap + monthly cap + split-payment)
  B. atlas-1 → "Acme Corp Ltd" $100 BLOCKED (lookalike vendor, unapproved)
  C. atlas-2 → Globex $400 (3rd this month) BLOCKED (split-payment, $1,200 total)
- MCP verified in prep (relate serve --mcp stdio against the demo store)

## Public repo
- **https://github.com/georgeonweb3/aegis-graph**
- Commit: `acb3e3e3a616f986def71823346dfc8e5c467f81` (main, "Aegis Graph: spend guard that shows its work …")
- Visibility: **public**
- Topics (verified via GitHub API): `relate`, `relate-neo4j-hackathon`, `neo4j`, `graph-database`, `ai-agents`, `spend-guard` — the required `relate` tag is set.

## Devpost — NOT DONE (needs the live browser)
- Hackathon: https://relate.devpost.com — George is **not yet registered** and no project entry exists.
- Subagent cannot drive the browser: registration + starting the project entry must be done in the parent agent's browser with George's signed-in Devpost session (prefer "Sign in with Google" per his standing preference).
- Steps for that run: sign in at relate.devpost.com → join/register for the hackathon → start a project entry pointing at https://github.com/georgeonweb3/aegis-graph → fill in the description (use case + how it uses Relate, from the repo README) → **do NOT submit** (no demo video yet).
- Judging criteria (from the Devpost page): Relate & connected context 30, Functionality 25, Usefulness 20, Documentation 15, Creativity 10.

## Remaining work
- [ ] Devpost registration + project entry started (browser step above)
- [ ] Demo video, 1–2 min, screen share (Week 4) — NOT started, do not build yet
- [ ] Final submit by **Fri Dec 11, 2026, 6:00 PM PST (03:00 WAT Sat Dec 12)**; winners Dec 17
- [ ] Prizes are hardware only ($6,197 total): Mac Studio M5 Max $3,799 / Mac mini M6 32GB $1,499 / Mac mini M6 16GB $899 — Neo4j ships at their cost, George pays import duties/taxes into Nigeria
