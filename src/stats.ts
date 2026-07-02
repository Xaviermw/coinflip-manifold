// Wilson score interval for a binomial proportion.
// Unlike the normal-approximation (Wald) interval, this does not collapse to
// zero width at p=0 or p=1, so a creator with a perfect record over a small
// sample no longer gets a degenerate [0,0] / [1,1] confidence interval.
export function wilsonInterval(
  successes: number,
  total: number,
  z: number
): { lower_ci: number; upper_ci: number } {
  if (total === 0) return { lower_ci: 0, upper_ci: 1 };
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    lower_ci: Math.max(0, center - margin),
    upper_ci: Math.min(1, center + margin),
  };
}
