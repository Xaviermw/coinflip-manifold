import { fetchAllResolvedBinaryMarkets } from "./api";
import { wilsonInterval } from "./stats";
import { deadlineInFuture } from "./text";
import * as fs from "fs";
import * as path from "path";

const CONFIDENCE_Z = 1.28; // 80% two-sided CI
const MIN_SAMPLE = 20; // require a real track record before trading a creator
const OUTPUT_PATH = path.join(__dirname, "new_targets.json");

type TargetClassification = "Target Yes" | "Target No" | "Balanced User" | "Low Sample Size";

export type TargetUser = {
  username: string;
  YES: number;
  NO: number;
  sample_size: number;
  percentage: number;
  lower_ci: number;
  upper_ci: number;
  target: TargetClassification;
};

function classify(lower_ci: number, upper_ci: number, sample_size: number): TargetClassification {
  if (sample_size <= MIN_SAMPLE) return "Low Sample Size";
  if (lower_ci > 0.5) return "Target Yes";
  if (upper_ci < 0.5) return "Target No";
  return "Balanced User";
}

async function main() {
  console.log("Fetching all resolved BINARY markets from Manifold...");
  const markets = await fetchAllResolvedBinaryMarkets();

  // Exclude future-deadline markets (resolved early, YES-biased) so a creator's
  // record isn't inflated by their open long-dated markets — same survivorship
  // correction as the phrase analysis.
  const resolved = markets.filter(
    (m) => (m.resolution === "YES" || m.resolution === "NO") && !deadlineInFuture(m.question)
  );
  console.log(`${resolved.length} of ${markets.length} markets have a settled YES/NO resolution`);

  // Count YES/NO resolutions per creator
  const counts = new Map<string, { YES: number; NO: number }>();
  for (const market of resolved) {
    const entry = counts.get(market.creatorUsername) ?? { YES: 0, NO: 0 };
    if (market.resolution === "YES") entry.YES++;
    else entry.NO++;
    counts.set(market.creatorUsername, entry);
  }

  // Compute CI and classify each creator
  const targets: TargetUser[] = [];
  for (const [username, { YES, NO }] of Array.from(counts)) {
    const sample_size = YES + NO;
    const percentage = YES / sample_size;
    const { lower_ci, upper_ci } = wilsonInterval(YES, sample_size, CONFIDENCE_Z);
    const target = classify(lower_ci, upper_ci, sample_size);
    targets.push({ username, YES, NO, sample_size, percentage, lower_ci, upper_ci, target });
  }

  const summary = targets.reduce((acc, t) => {
    acc[t.target] = (acc[t.target] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("Classification summary:", summary);
  console.log(`Writing ${targets.length} users to ${OUTPUT_PATH}`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(targets));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
