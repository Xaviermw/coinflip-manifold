import { getMe, getBets, getMarketById, sellShares } from "./api";
import * as fs from "fs";
import * as path from "path";

// Reviews open positions and flags ones whose originating signal has since been
// retired (a phrase no longer in phrase_targets.json, or a creator no longer an
// actionable target in new_targets.json — e.g. the survivorship-artifact bets).
// Dry-run by default; pass --execute to actually sell the flagged positions.

const BET_LOG_PATH = path.join(__dirname, "bet_log.jsonl");
const EXECUTE = process.argv.includes("--execute");

type BetLogEntry = {
  marketId: string;
  question: string;
  outcome: "YES" | "NO";
  amount: number;
  source: "creator" | "phrase";
  label: string;
};

type PhraseTarget = { phrase: string };
type TargetUser = { username: string; target: string };

// Active signals after the latest pipeline run.
const activePhrases = new Set(
  (require("./phrase_targets.json") as PhraseTarget[]).map((p) => p.phrase)
);
const activeCreators = new Set(
  (require("./new_targets.json") as TargetUser[])
    .filter((u) => u.target === "Target Yes" || u.target === "Target No")
    .map((u) => u.username)
);

function isRetired(source: "creator" | "phrase", label: string): boolean {
  return source === "phrase" ? !activePhrases.has(label) : !activeCreators.has(label);
}

async function main() {
  if (!fs.existsSync(BET_LOG_PATH)) {
    console.error(`No bet log found at ${BET_LOG_PATH}`);
    process.exit(1);
  }

  const me = await getMe();
  const lines = fs.readFileSync(BET_LOG_PATH, "utf8").split("\n").filter(Boolean);
  const bets: BetLogEntry[] = lines.map((l) => JSON.parse(l));

  // Collapse the log to one row per market+outcome (a market may have several
  // logged bets), keeping the representative signal and total staked.
  const positions = new Map<string, { entry: BetLogEntry; staked: number }>();
  for (const b of bets) {
    const key = `${b.marketId}:${b.outcome}`;
    const existing = positions.get(key);
    if (existing) existing.staked += b.amount;
    else positions.set(key, { entry: b, staked: b.amount });
  }

  const flagged = Array.from(positions.values()).filter(({ entry }) =>
    isRetired(entry.source, entry.label)
  );

  console.log(
    `${positions.size} logged positions, ${flagged.length} from now-retired signals.` +
    (EXECUTE ? " EXECUTING sells." : " Dry run — pass --execute to sell.")
  );

  let totalRecoverable = 0;
  for (const { entry, staked } of flagged) {
    let market;
    try {
      market = await getMarketById(entry.marketId);
    } catch (err) {
      console.log(`\n${entry.question}\n  could not fetch market: ${err}`);
      continue;
    }
    if (market.isResolved) continue; // nothing to sell

    // Net shares we currently hold on this outcome (buys minus any sells).
    const myBets = await getBets({ contractId: entry.marketId, userId: me.id });
    const shares = myBets
      .filter((bt) => bt.outcome === entry.outcome)
      .reduce((sum, bt) => sum + (bt.shares ?? 0), 0);
    if (shares < 1) continue; // position already closed/negligible

    const price = entry.outcome === "YES" ? market.probability : 1 - market.probability;
    const recoverable = shares * price; // ignores CPMM slippage on the sale
    totalRecoverable += recoverable;

    const closesIn = market.closeTime
      ? `${Math.round((market.closeTime - Date.now()) / (1000 * 60 * 60 * 24))}d`
      : "n/a";

    console.log(
      `\n${entry.question}` +
      `\n  ${entry.source} signal "${entry.label}" (retired) | ${entry.outcome} | ` +
      `staked ${staked.toFixed(0)} | now ${(market.probability * 100).toFixed(0)}% | ` +
      `${shares.toFixed(0)} shares ~= ${recoverable.toFixed(0)} mana | closes in ${closesIn}`
    );

    if (EXECUTE) {
      try {
        const sold = await sellShares(entry.marketId, { outcome: entry.outcome });
        const proceeds = Math.abs(sold.amount);
        console.log(`  -> sold: recovered ~${proceeds.toFixed(0)} mana`);
        // Record the sale so analyze-pnl can realize P&L on it instead of
        // treating the position as still open / held to resolution.
        fs.appendFileSync(
          BET_LOG_PATH,
          JSON.stringify({
            type: "sell",
            timestamp: Date.now(),
            marketId: entry.marketId,
            question: entry.question,
            outcome: entry.outcome,
            source: entry.source,
            label: entry.label,
            proceeds,
            shares: Math.abs(sold.shares ?? 0),
            betId: sold.id,
          }) + "\n"
        );
      } catch (err) {
        console.log(`  -> sell failed: ${err}`);
      }
    }
  }

  console.log(
    `\nTotal estimated recoverable from flagged positions: ${totalRecoverable.toFixed(0)} mana` +
    (EXECUTE ? "" : "\nRe-run with --execute to sell them.")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
