import { getMarketById } from "./api";
import * as fs from "fs";
import * as path from "path";

// Joins bet_log.jsonl against current market resolutions and reports realized
// ROI, broken down by strategy source and by label (creator / phrase). Use this
// to decide which signals actually make money and which to prune.

const BET_LOG_PATH = path.join(__dirname, "bet_log.jsonl");

type BetLogEntry = {
  timestamp: number;
  marketId: string;
  question: string;
  creator: string;
  outcome: "YES" | "NO";
  amount: number;
  source: "creator" | "phrase";
  label: string;
  targetProb: number;
  betId: string;
  probBefore: number;
  probAfter: number;
  // Present only on newer entries (older bets predate these fields):
  shares?: number;
  creatorOutcome?: "YES" | "NO" | null;
  phraseOutcome?: "YES" | "NO" | null;
};

// Categorizes a bet by which signals actually fired, for true per-method
// attribution. Falls back to `source` for older entries lacking the fields.
function attribution(bet: BetLogEntry): "creator-only" | "phrase-only" | "both-agree" | `legacy-${string}` {
  if (bet.creatorOutcome === undefined || bet.phraseOutcome === undefined) return `legacy-${bet.source}`;
  const c = bet.creatorOutcome !== null;
  const p = bet.phraseOutcome !== null;
  if (c && p) return "both-agree";
  if (c) return "creator-only";
  return "phrase-only";
}

type Group = { staked: number; profit: number; wins: number; losses: number; pending: number };

function emptyGroup(): Group {
  return { staked: 0, profit: 0, wins: 0, losses: 0, pending: 0 };
}

// Profit if the market resolves as given. Uses the exact fill shares when the
// entry has them; older entries fall back to estimating shares from the average
// fill price (midpoint of the probability move). Winning shares pay 1 mana each.
function estimateProfit(bet: BetLogEntry, resolution: "YES" | "NO"): number {
  let shares = bet.shares;
  if (shares === undefined) {
    const midProb = (bet.probBefore + bet.probAfter) / 2;
    const price = bet.outcome === "YES" ? midProb : 1 - midProb;
    shares = price > 0 ? bet.amount / price : 0;
  }
  return bet.outcome === resolution ? shares - bet.amount : -bet.amount;
}

function addTo(map: Map<string, Group>, key: string, staked: number, profit: number | null) {
  const g = map.get(key) ?? emptyGroup();
  g.staked += staked;
  if (profit === null) {
    g.pending++;
  } else {
    g.profit += profit;
    if (profit >= 0) g.wins++;
    else g.losses++;
  }
  map.set(key, g);
}

function report(title: string, map: Map<string, Group>) {
  console.log(`\n=== ${title} ===`);
  const rows = Array.from(map.entries()).sort((a, b) => a[1].profit - b[1].profit);
  for (const [key, g] of rows) {
    const settled = g.wins + g.losses;
    const roi = g.staked > 0 ? (g.profit / g.staked) * 100 : 0;
    console.log(
      `${key.padEnd(28)} profit ${g.profit.toFixed(0).padStart(8)} | ` +
      `staked ${g.staked.toFixed(0).padStart(7)} | ROI ${roi.toFixed(1).padStart(6)}% | ` +
      `${g.wins}W-${g.losses}L (${settled} settled, ${g.pending} pending)`
    );
  }
}

async function main() {
  if (!fs.existsSync(BET_LOG_PATH)) {
    console.error(`No bet log found at ${BET_LOG_PATH}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(BET_LOG_PATH, "utf8").split("\n").filter(Boolean);
  const bets: BetLogEntry[] = lines.map((l) => JSON.parse(l));
  console.log(`Loaded ${bets.length} logged bets. Fetching resolutions...`);

  // Cache resolutions so we hit each market only once.
  const resolutionCache = new Map<string, string | undefined>();
  async function resolutionFor(marketId: string): Promise<string | undefined> {
    if (resolutionCache.has(marketId)) return resolutionCache.get(marketId);
    try {
      const m = await getMarketById(marketId);
      const res = m.isResolved ? m.resolution : undefined;
      resolutionCache.set(marketId, res);
      return res;
    } catch (err) {
      console.error(`  failed to fetch market ${marketId}: ${err}`);
      resolutionCache.set(marketId, undefined);
      return undefined;
    }
  }

  const bySource = new Map<string, Group>();
  const byLabel = new Map<string, Group>();
  const byAttribution = new Map<string, Group>();
  const overall = emptyGroup();
  let profitSum = 0;

  for (const bet of bets) {
    const resolution = await resolutionFor(bet.marketId);
    const settled = resolution === "YES" || resolution === "NO";
    const profit = settled ? estimateProfit(bet, resolution as "YES" | "NO") : null;

    addTo(bySource, bet.source, bet.amount, profit);
    addTo(byLabel, `${bet.source}:${bet.label}`, bet.amount, profit);
    addTo(byAttribution, attribution(bet), bet.amount, profit);

    overall.staked += bet.amount;
    if (profit === null) {
      overall.pending++;
    } else {
      overall.profit += profit;
      profitSum += profit;
      if (profit >= 0) overall.wins++;
      else overall.losses++;
    }
  }

  report("By strategy source", bySource);
  report("By attribution (which signals fired)", byAttribution);
  report("By label (worst first)", byLabel);

  const settled = overall.wins + overall.losses;
  const roi = overall.staked > 0 ? (overall.profit / overall.staked) * 100 : 0;
  console.log(
    `\n=== Overall ===\n` +
    `Realized profit: ${profitSum.toFixed(0)} mana | staked ${overall.staked.toFixed(0)} | ROI ${roi.toFixed(1)}%\n` +
    `${overall.wins}W-${overall.losses}L (${settled} settled, ${overall.pending} still open)\n` +
    `Note: profit is estimated from the logged probability move, not exact fill shares.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
