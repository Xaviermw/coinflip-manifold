import { fetchAllResolvedBinaryMarkets } from "./api";
import { tokenize, deadlineInFuture } from "./text";
import { wilsonInterval } from "./stats";
import * as fs from "fs";
import * as path from "path";

const CONFIDENCE_Z = 2.0; // ~95% CI — tighter, to blunt the multiple-comparisons problem
const MIN_SAMPLE = 50;
const MIN_CREATORS = 5;
const TOP_N = 30;
const MAX_LEADING_WORDS = 5;
const MAX_NGRAM = 3;

// Stricter bar for phrases the bot will actually trade on, since thousands of
// candidate phrases are tested here (multiple-comparisons risk).
const TARGET_MIN_CREATORS = 15;
const TARGET_CI_BOUND = 0.3; // require lower_ci > 1-TARGET_CI_BOUND or upper_ci < TARGET_CI_BOUND
const PHRASE_TARGETS_PATH = path.join(__dirname, "phrase_targets.json");

type Counts = { YES: number; NO: number; creators: Set<string> };
type PhraseStats = {
  phrase: string;
  YES: number;
  NO: number;
  sample_size: number;
  unique_creators: number;
  percentage: number;
  lower_ci: number;
  upper_ci: number;
};

export type PhraseTarget = {
  phrase: string;
  kind: "leading" | "contains";
  outcome: "YES" | "NO";
  sample_size: number;
  unique_creators: number;
  percentage: number;
  lower_ci: number;
  upper_ci: number;
};

function bump(counts: Map<string, Counts>, phrase: string, resolution: "YES" | "NO", creator: string) {
  const entry = counts.get(phrase) ?? { YES: 0, NO: 0, creators: new Set<string>() };
  entry[resolution]++;
  entry.creators.add(creator);
  counts.set(phrase, entry);
}

function computeStats(phrase: string, counts: Counts): PhraseStats {
  const sample_size = counts.YES + counts.NO;
  const percentage = counts.YES / sample_size;
  const { lower_ci, upper_ci } = wilsonInterval(counts.YES, sample_size, CONFIDENCE_Z);
  return {
    phrase,
    YES: counts.YES,
    NO: counts.NO,
    sample_size,
    unique_creators: counts.creators.size,
    percentage,
    lower_ci,
    upper_ci,
  };
}

function printTopBiased(
  counts: Map<string, Counts>,
  label: string,
  kind: "leading" | "contains"
): PhraseTarget[] {
  const stats = Array.from(counts.entries())
    .filter(([, c]) => c.YES + c.NO >= MIN_SAMPLE && c.creators.size >= MIN_CREATORS)
    .map(([phrase, c]) => computeStats(phrase, c));

  const yesBiased = stats
    .filter((s) => s.lower_ci > 0.5)
    .sort((a, b) => b.lower_ci - a.lower_ci)
    .slice(0, TOP_N);

  const noBiased = stats
    .filter((s) => s.upper_ci < 0.5)
    .sort((a, b) => a.upper_ci - b.upper_ci)
    .slice(0, TOP_N);

  console.log(`\n=== ${label}: biased toward YES ===`);
  for (const s of yesBiased) {
    console.log(
      `"${s.phrase}" — ${(s.percentage * 100).toFixed(0)}% YES ` +
      `(n=${s.sample_size}, creators=${s.unique_creators}, CI ${(s.lower_ci * 100).toFixed(0)}-${(s.upper_ci * 100).toFixed(0)}%)`
    );
  }

  console.log(`\n=== ${label}: biased toward NO ===`);
  for (const s of noBiased) {
    console.log(
      `"${s.phrase}" — ${(s.percentage * 100).toFixed(0)}% YES ` +
      `(n=${s.sample_size}, creators=${s.unique_creators}, CI ${(s.lower_ci * 100).toFixed(0)}-${(s.upper_ci * 100).toFixed(0)}%)`
    );
  }

  // Stricter subset that the bot will actually trade on
  const targets: PhraseTarget[] = stats
    // Single tokens (e.g. "human", "produce", "2027") are almost always
    // overfit noise rather than a real signal — require a multi-word phrase.
    .filter((s) => s.phrase.split(" ").length > 1)
    .filter((s) => s.unique_creators >= TARGET_MIN_CREATORS)
    .filter((s) => s.lower_ci > 1 - TARGET_CI_BOUND || s.upper_ci < TARGET_CI_BOUND)
    .map((s) => ({
      phrase: s.phrase,
      kind,
      outcome: s.lower_ci > 1 - TARGET_CI_BOUND ? "YES" : "NO",
      sample_size: s.sample_size,
      unique_creators: s.unique_creators,
      percentage: s.percentage,
      lower_ci: s.lower_ci,
      upper_ci: s.upper_ci,
    }));

  return targets;
}

async function main() {
  console.log("Fetching all resolved BINARY markets from Manifold...");
  const markets = await fetchAllResolvedBinaryMarkets();

  // Drop markets whose stated deadline is still in the future — those resolved
  // EARLY (usually YES) and are censored data, producing the "before 2030 =>
  // YES" survivorship artifact. Deadline is parsed from the question text since
  // closeTime is rewritten to the resolution time on early resolution.
  const resolved = markets.filter(
    (m) => (m.resolution === "YES" || m.resolution === "NO") && !deadlineInFuture(m.question)
  );
  console.log(`${resolved.length} of ${markets.length} markets have a settled, past-deadline YES/NO resolution`);

  const leadingCounts = new Map<string, Counts>();
  const containsCounts = new Map<string, Counts>();

  for (const market of resolved) {
    const resolution = market.resolution as "YES" | "NO";
    const creator = market.creatorUsername;
    const tokens = tokenize(market.question);

    for (let n = 1; n <= Math.min(MAX_LEADING_WORDS, tokens.length); n++) {
      bump(leadingCounts, tokens.slice(0, n).join(" "), resolution, creator);
    }

    for (let n = 1; n <= MAX_NGRAM; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        bump(containsCounts, tokens.slice(i, i + n).join(" "), resolution, creator);
      }
    }
  }

  const leadingTargets = printTopBiased(leadingCounts, "Leading phrase (start of question)", "leading");
  const containsTargets = printTopBiased(containsCounts, "Phrase anywhere in question", "contains");

  const allTargets = [...leadingTargets, ...containsTargets];
  console.log(`\nWriting ${allTargets.length} high-confidence phrase targets to ${PHRASE_TARGETS_PATH}`);
  fs.writeFileSync(PHRASE_TARGETS_PATH, JSON.stringify(allTargets));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
