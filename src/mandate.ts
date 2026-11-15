/**
 * REUSE DISCLOSURE (Relate by Neo4j Hackathon, Official Rules §3):
 * This file is George Agbe's own earlier code, copied from the
 * Aegis-for-Jira Codegeist 2026 scaffold (MIT, his repo
 * github.com/georgeonweb3/aegis-for-jira), where the same engine was
 * unit-tested 20/20. Only work done during the Relate Contest Period
 * (Nov 11 – Dec 11, 2026) is judged: the new work in this repo is the
 * Relate graph layer, the queries, the seed data, the MCP wiring, the
 * demo and the docs. The engine itself is unchanged apart from this
 * header.
 *
 * Aegis mandate engine — the spend-guard core, ported from the Aegis
 * on-chain spend-control model to Jira approvals.
 *
 * Pure TypeScript with no Forge dependencies, so every check below is
 * unit-tested in mandate.test.ts and the numbers quoted in the README
 * are real test results, not claims.
 *
 * A mandate is a human-set budget for a team: a monthly cap, a per-item
 * cap, and an explicit allow-list of vendors. Nothing else can be spent.
 * The engine never approves what the mandate does not allow, and it
 * reports every failed check instead of failing silently.
 */

export interface Mandate {
  id: string;
  name: string;
  /** USD the team may spend in total this month. */
  monthlyCapUsd: number;
  /** USD allowed for any single payment. */
  perItemCapUsd: number;
  /** Exact vendor names allowed. Matching is case-insensitive but exact:
   *  "Acme Corp Ltd" does NOT match "Acme Corp" — lookalikes are blocked. */
  approvedVendors: string[];
  /** YYYY-MM the mandate applies to. */
  monthKey: string;
  /** USD already spent this month (from the recorded audit ledger). */
  spentThisMonthUsd: number;
}

export interface SpendRequest {
  issueKey: string;
  vendor: string;
  amountUsd: number;
  description?: string;
  /** ISO timestamp, used for the repeated-payment review trigger. */
  requestedAt?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export type Decision = 'APPROVED' | 'BLOCKED' | 'NEEDS_REVIEW';

export interface Verdict {
  decision: Decision;
  reasons: string[];
  checks: CheckResult[];
  /** Monthly budget left before this request. */
  remainingMonthlyUsd: number;
  /** Monthly budget left if this request is approved. */
  remainingAfterApprovalUsd: number;
}

function normalizeVendor(vendor: string): string {
  return vendor.trim().toLowerCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Check a spend request against a mandate.
 *
 * `recentRequests` are spend requests from the same month that have been
 * recorded in the audit ledger but are not yet counted in
 * `mandate.spentThisMonthUsd`. They exist so a team cannot dodge the
 * monthly cap by splitting one payment into several small ones.
 */
export function checkSpend(
  mandate: Mandate,
  request: SpendRequest,
  recentRequests: SpendRequest[] = [],
): Verdict {
  const checks: CheckResult[] = [];
  const reasons: string[] = [];
  let blocked = false;
  let needsReview = false;

  const remainingMonthlyUsd = round2(mandate.monthlyCapUsd - mandate.spentThisMonthUsd);

  // 1. Amount must be a real, positive number.
  const amountValid = Number.isFinite(request.amountUsd) && request.amountUsd > 0;
  checks.push({
    name: 'amount-valid',
    passed: amountValid,
    detail: amountValid
      ? `Amount $${request.amountUsd.toFixed(2)} is a valid positive number.`
      : `Amount "${String(request.amountUsd)}" is not a valid positive number.`,
  });
  if (!amountValid) {
    blocked = true;
    reasons.push(`Invalid amount "${String(request.amountUsd)}" — a spend request needs a positive dollar amount.`);
  }

  // 2. Vendor must be on the allow-list, exact match (case-insensitive).
  const vendorNorm = normalizeVendor(request.vendor);
  const vendorApproved = mandate.approvedVendors.some((v) => normalizeVendor(v) === vendorNorm);
  checks.push({
    name: 'vendor-approved',
    passed: vendorApproved,
    detail: vendorApproved
      ? `Vendor "${request.vendor}" is on the approved list.`
      : `Vendor "${request.vendor}" is NOT on the approved list (${mandate.approvedVendors.join(', ') || 'none'}).`,
  });
  if (!vendorApproved) {
    blocked = true;
    reasons.push(`Vendor "${request.vendor}" is not approved. Approved vendors: ${mandate.approvedVendors.join(', ') || 'none'}.`);
  }

  // 3. Single payment must fit the per-item cap.
  const perItemOk = amountValid && request.amountUsd <= mandate.perItemCapUsd;
  checks.push({
    name: 'per-item-cap',
    passed: perItemOk,
    detail: amountValid
      ? `$${request.amountUsd.toFixed(2)} against a per-item cap of $${mandate.perItemCapUsd.toFixed(2)}.`
      : 'Skipped: amount is invalid.',
  });
  if (amountValid && !perItemOk) {
    blocked = true;
    reasons.push(
      `$${request.amountUsd.toFixed(2)} exceeds the per-item cap of $${mandate.perItemCapUsd.toFixed(2)} by $${round2(request.amountUsd - mandate.perItemCapUsd).toFixed(2)}.`,
    );
  }

  // 4. The month's total must fit the monthly cap.
  const monthlyOk = amountValid && mandate.spentThisMonthUsd + request.amountUsd <= mandate.monthlyCapUsd;
  checks.push({
    name: 'monthly-cap',
    passed: monthlyOk,
    detail: amountValid
      ? `Spent $${mandate.spentThisMonthUsd.toFixed(2)} of $${mandate.monthlyCapUsd.toFixed(2)} this month; this request would take it to $${round2(mandate.spentThisMonthUsd + request.amountUsd).toFixed(2)}.`
      : 'Skipped: amount is invalid.',
  });
  if (amountValid && !monthlyOk) {
    blocked = true;
    reasons.push(
      `This request would take monthly spend to $${round2(mandate.spentThisMonthUsd + request.amountUsd).toFixed(2)}, $${round2(mandate.spentThisMonthUsd + request.amountUsd - mandate.monthlyCapUsd).toFixed(2)} over the $${mandate.monthlyCapUsd.toFixed(2)} monthly cap.`,
    );
  }

  // 5. Split-payment evasion: several small requests to the same vendor
  //    that together break the monthly cap. Counted against the ledger,
  //    not just against the recorded monthly total.
  const sameVendorRecent = recentRequests.filter((r) => normalizeVendor(r.vendor) === vendorNorm);
  const recentSameVendorTotal = round2(sameVendorRecent.reduce((sum, r) => sum + r.amountUsd, 0));
  const splitTotal = round2(mandate.spentThisMonthUsd + recentSameVendorTotal + request.amountUsd);
  const splitOk = !amountValid || splitTotal <= mandate.monthlyCapUsd;
  checks.push({
    name: 'split-payment',
    passed: splitOk,
    detail:
      sameVendorRecent.length === 0
        ? 'No other requests from this vendor recorded this month.'
        : `${sameVendorRecent.length} other request(s) from this vendor this month totalling $${recentSameVendorTotal.toFixed(2)}; combined with this request the month would reach $${splitTotal.toFixed(2)}.`,
  });
  if (amountValid && !splitOk) {
    blocked = true;
    reasons.push(
      `Split-payment pattern: ${sameVendorRecent.length + 1} requests to "${request.vendor}" this month totalling $${splitTotal.toFixed(2)}, which breaks the $${mandate.monthlyCapUsd.toFixed(2)} monthly cap even though each payment alone looks small.`,
    );
  }

  // 6. Review triggers — nothing blocked, but a human should look.
  if (!blocked && amountValid) {
    if (request.amountUsd > 0.8 * mandate.perItemCapUsd) {
      needsReview = true;
      reasons.push(
        `Amount $${request.amountUsd.toFixed(2)} is over 80% of the $${mandate.perItemCapUsd.toFixed(2)} per-item cap — large for a single payment.`,
      );
    }
    const remainingAfter = round2(remainingMonthlyUsd - request.amountUsd);
    if (remainingAfter < 0.1 * mandate.monthlyCapUsd) {
      needsReview = true;
      reasons.push(
        `Approving this leaves only $${remainingAfter.toFixed(2)} of the $${mandate.monthlyCapUsd.toFixed(2)} monthly budget.`,
      );
    }
    if (sameVendorRecent.length >= 2) {
      needsReview = true;
      reasons.push(
        `${sameVendorRecent.length} other payments to "${request.vendor}" already recorded this month — repeated payments to one vendor deserve a second look.`,
      );
    }
  }

  const decision: Decision = blocked ? 'BLOCKED' : needsReview ? 'NEEDS_REVIEW' : 'APPROVED';
  if (decision === 'APPROVED') {
    reasons.push('All mandate checks passed.');
  }

  return {
    decision,
    reasons,
    checks,
    remainingMonthlyUsd,
    remainingAfterApprovalUsd: amountValid ? round2(remainingMonthlyUsd - request.amountUsd) : remainingMonthlyUsd,
  };
}

/** The example mandate the app ships with. A site admin replaces it with
 *  the team's real numbers through the agent ("set our mandate") — the
 *  example is clearly flagged so nobody mistakes it for a real budget. */
export const EXAMPLE_MANDATE: Mandate = {
  id: 'example',
  name: 'Example team mandate (replace me)',
  monthlyCapUsd: 1000,
  perItemCapUsd: 500,
  approvedVendors: ['Acme Corp', 'Globex', 'Initech'],
  monthKey: new Date().toISOString().slice(0, 7),
  spentThisMonthUsd: 800,
};

export interface ParsedSpend {
  amountUsd?: number;
  vendor?: string;
}

/**
 * Pull a dollar amount and a vendor out of free text (a Jira issue
 * summary or description). Amount: first `$1,234.56` style figure.
 * Vendor: a `Vendor: <name>` line. Returns whichever it finds — the
 * caller decides what to do when a field is missing.
 */
export function parseSpendFromText(text: string): ParsedSpend {
  const out: ParsedSpend = {};
  const amountMatch = text.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  if (amountMatch) {
    const value = Number(amountMatch[1].replace(/,/g, ''));
    if (Number.isFinite(value)) {
      out.amountUsd = value;
    }
  }
  const vendorMatch = text.match(/vendor\s*:\s*([^\n\r]+)/i);
  if (vendorMatch) {
    const vendor = vendorMatch[1].trim();
    if (vendor) {
      out.vendor = vendor;
    }
  }
  return out;
}
