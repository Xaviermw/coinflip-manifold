export function tokenize(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// True if the question names a year whose end is still in the future. Such a
// market's YES/NO resolution is censored: it can only appear in the resolved
// set because it resolved EARLY (almost always YES), so training on it produces
// survivorship bias (the "before 2030 => YES" artifact). We can't use closeTime
// for this because Manifold rewrites it to the resolution time on early
// resolution. No year mentioned => can't tell => keep the market.
export function deadlineInFuture(question: string, now: number = Date.now()): boolean {
  const years = (question.match(/\b(20\d{2})\b/g) ?? []).map(Number);
  if (years.length === 0) return false;
  const maxYear = Math.max(...years);
  const endOfYear = Date.UTC(maxYear, 11, 31, 23, 59, 59); // Dec 31 of that year
  return endOfYear > now;
}
