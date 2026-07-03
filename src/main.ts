import { searchMarkets, placeBet, getMe, LiteMarket } from "./api";
import { tokenize } from "./text";
import * as fs from "fs";
import * as path from "path";

type TargetUser = {
  username: string;
  target: "Target Yes" | "Target No" | "Balanced User" | "Low Sample Size";
  lower_ci: number;
  upper_ci: number;
  percentage: number;
  sample_size: number;
  YES: number;
  NO: number;
};

type PhraseTarget = {
  phrase: string;
  kind: "leading" | "contains";
  outcome: "YES" | "NO";
  sample_size: number;
  unique_creators: number;
  percentage: number;
  lower_ci: number;
  upper_ci: number;
};

type Signal = {
  outcome: "YES" | "NO";
  targetProb: number;
  source: "creator" | "phrase";
  label: string;
};

const rawTargets: TargetUser[] = require("./new_targets.json");
const TARGET_USERS = new Map<string, TargetUser>(rawTargets.map((u) => [u.username, u]));

const rawPhraseTargets: PhraseTarget[] = require("./phrase_targets.json");
const LEADING_PHRASES = new Map<string, PhraseTarget>(
  rawPhraseTargets.filter((p) => p.kind === "leading").map((p) => [p.phrase, p])
);
const CONTAINS_PHRASES = new Map<string, PhraseTarget>(
  rawPhraseTargets.filter((p) => p.kind === "contains").map((p) => [p.phrase, p])
);

// These users are excluded even if present in TARGET_USERS
const SKIP_USERS = new Set(["fim789", "benjaminIkuta"]);

const POLL_INTERVAL_MS = 30_000;
const MIN_BET = 1;
const MAX_BET_FRACTION = 0.02; // never risk more than 2% of current balance on a single bet
const MIN_EDGE = 0.1; // skip signals within 10% of 50/50 — the edge is too small to be worth the churn
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000; // skip markets closing more than a year out (capital lock-up)
const STRATEGIES = parseStrategies();
const BET_LOG_PATH = path.join(__dirname, "bet_log.jsonl");

type BetLogEntry = {
  timestamp: number;
  marketId: string;
  question: string;
  creator: string;
  outcome: "YES" | "NO";
  amount: number;
  source: "creator" | "phrase"; // which signal drove the bet (creator wins ties)
  label: string;
  targetProb: number;
  betId: string;
  shares: number; // exact shares from the fill, so P&L is exact rather than estimated
  probBefore: number;
  probAfter: number;
  // What each signal independently said, so P&L can be attributed per method
  // even when both fired (agreement bets are logged under source "creator").
  creatorOutcome: "YES" | "NO" | null;
  phraseOutcome: "YES" | "NO" | null;
};

function logBet(entry: BetLogEntry) {
  fs.appendFileSync(BET_LOG_PATH, JSON.stringify(entry) + "\n");
}

function parseStrategies(): Set<"creator" | "phrase"> {
  const arg = process.argv.find((a) => a.startsWith("--strategies="));
  if (!arg) return new Set<"creator" | "phrase">(["creator", "phrase"]);
  const list = arg.split("=")[1].split(",").map((s) => s.trim());
  return new Set(list as ("creator" | "phrase")[]);
}

function creatorSignal(market: LiteMarket): Signal | null {
  if (!STRATEGIES.has("creator")) return null;
  const creator = market.creatorUsername;
  const targetUser = TARGET_USERS.get(creator);
  if (!targetUser || SKIP_USERS.has(creator)) return null;

  if (targetUser.target === "Target Yes") {
    return { outcome: "YES", targetProb: Math.min(targetUser.lower_ci, 0.95), source: "creator", label: creator };
  }
  if (targetUser.target === "Target No") {
    return { outcome: "NO", targetProb: Math.max(targetUser.upper_ci, 0.05), source: "creator", label: creator };
  }
  return null;
}

function findPhraseTarget(question: string): PhraseTarget | null {
  const tokens = tokenize(question);

  // Most specific (longest) leading match wins
  for (let n = Math.min(5, tokens.length); n >= 1; n--) {
    const hit = LEADING_PHRASES.get(tokens.slice(0, n).join(" "));
    if (hit) return hit;
  }

  // Most specific (longest) contains match wins; n iterates longest-first
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const hit = CONTAINS_PHRASES.get(tokens.slice(i, i + n).join(" "));
      if (hit) return hit;
    }
  }
  return null;
}

function phraseSignal(market: LiteMarket): Signal | null {
  if (!STRATEGIES.has("phrase")) return null;
  const hit = findPhraseTarget(market.question);
  if (!hit) return null;

  const targetProb = hit.outcome === "YES" ? Math.min(hit.lower_ci, 0.95) : Math.max(hit.upper_ci, 0.05);
  return { outcome: hit.outcome, targetProb, source: "phrase", label: hit.phrase };
}

function resolveSignal(market: LiteMarket): Signal | null {
  const cSignal = creatorSignal(market);
  const pSignal = phraseSignal(market);

  if (cSignal && pSignal) {
    if (cSignal.outcome === pSignal.outcome) {
      console.log(`Agreeing signals on ${market.creatorUsername}'s market: creator + phrase "${pSignal.label}" both say ${cSignal.outcome}`);
      return cSignal; // creator CI is specific to this exact person, used for sizing
    }
    console.log(`Conflicting signals on ${market.creatorUsername}'s market: creator says ${cSignal.outcome}, phrase "${pSignal.label}" says ${pSignal.outcome} — skipping`);
    return null;
  }

  return cSignal ?? pSignal;
}

const main = async () => {
  const username = process.env.MANIFOLD_USERNAME;
  const key = process.env.MANIFOLD_API_KEY;
  if (!username) throw new Error("Please set MANIFOLD_USERNAME in .env file.");
  if (!key) throw new Error("Please set MANIFOLD_API_KEY in .env file.");

  console.log(`Starting trading bot with strategies: ${Array.from(STRATEGIES).join(", ")}`);

  const seenMarkets = new Set<string>();
  let totalBets = 0;

  while (true) {
    let betsThisRound = 0;
    try {
      const [markets, me] = await Promise.all([
        searchMarkets({ sort: "newest", filter: "open", contractType: "BINARY", limit: 100 }),
        getMe(),
      ]);

      const maxBet = Math.floor(me.balance * MAX_BET_FRACTION);
      let newMarkets = 0;
      let qualifiedMarkets = 0;

      for (const market of markets) {
        if (seenMarkets.has(market.id)) continue;
        seenMarkets.add(market.id);
        newMarkets++;

        if (
          market.volume !== 0 ||
          market.isResolved ||
          Math.abs(market.probability - 0.5) > 0.01 ||
          market.question.toLowerCase().includes("stock")
        ) continue;

        qualifiedMarkets++;
        if (market.closeTime && Date.now() >= market.closeTime) continue;
        if (market.closeTime && market.closeTime - Date.now() > MAX_HORIZON_MS) continue;

        const signal = resolveSignal(market);
        if (!signal) continue;

        const placed = await placeSignalBet(market, signal, maxBet);
        if (placed) betsThisRound++;
      }

      console.log(`Balance: ${me.balance.toFixed(0)} | Max bet: ${maxBet} | New markets: ${newMarkets} | Qualified: ${qualifiedMarkets}`);
    } catch (err) {
      console.error(`Poll error: ${err}`);
    }

    totalBets += betsThisRound;
    console.log(`Bets this round: ${betsThisRound} | Total: ${totalBets}`);
    await sleep(POLL_INTERVAL_MS);
  }
};

async function placeSignalBet(market: LiteMarket, signal: Signal, maxBet: number): Promise<boolean> {
  const liquidity = market.totalLiquidity ?? 0;
  if (liquidity <= 0) return false;

  // Skip signals too close to 50/50 — not enough edge to justify the churn/fees.
  if (Math.abs(signal.targetProb - 0.5) < MIN_EDGE) {
    console.log(`Edge too small (target ${(signal.targetProb * 100).toFixed(0)}%) for ${signal.source} signal "${signal.label}", skipping`);
    return false;
  }

  // Calculate mana needed to move CPMM market from 0.5 to the target probability.
  // Derived from constant-product AMM math with a symmetric starting pool.
  let betAmount: number;
  if (signal.outcome === "YES") {
    betAmount = liquidity * (Math.sqrt(signal.targetProb / (1 - signal.targetProb)) - 1);
  } else {
    betAmount = liquidity * (Math.sqrt((1 - signal.targetProb) / signal.targetProb) - 1);
  }

  betAmount = Math.min(Math.floor(betAmount), maxBet);
  if (betAmount < MIN_BET) {
    console.log(`Bet too small (${betAmount}) for ${signal.source} signal "${signal.label}", skipping`);
    return false;
  }

  console.log(
    `Betting ${betAmount} ${signal.outcome} on ${market.creatorUsername}'s market via ${signal.source} signal "${signal.label}" ` +
    `(target: ${(signal.targetProb * 100).toFixed(0)}%) — ${market.question}`
  );

  try {
    // limitProb makes this a limit order at the target price, so CPMM sizing
    // error can never overshoot past our intended probability (the cause of the
    // earlier 6,857-mana blowout that pushed a market to 1.6% instead of ~18%).
    const bet = await placeBet({
      contractId: market.id,
      amount: betAmount,
      outcome: signal.outcome,
      limitProb: Math.round(signal.targetProb * 100) / 100,
    });
    console.log(`  -> bet ${bet.id} | shares: ${bet.shares?.toFixed(2)} | prob after: ${(bet.probAfter * 100).toFixed(1)}%`);
    logBet({
      timestamp: Date.now(),
      marketId: market.id,
      question: market.question,
      creator: market.creatorUsername,
      outcome: signal.outcome,
      amount: betAmount,
      source: signal.source,
      label: signal.label,
      targetProb: signal.targetProb,
      betId: bet.id,
      shares: bet.shares,
      probBefore: bet.probBefore,
      probAfter: bet.probAfter,
      creatorOutcome: creatorSignal(market)?.outcome ?? null,
      phraseOutcome: phraseSignal(market)?.outcome ?? null,
    });
    return true;
  } catch (err) {
    console.error(`  -> failed to place bet: ${err}`);
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (require.main === module) {
  main();
}
