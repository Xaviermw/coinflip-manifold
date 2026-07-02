import "dotenv/config";

const yourKey = process.env.MANIFOLD_API_KEY;

const API_URL = "https://api.manifold.markets/v0";

// Throws on non-2xx responses so callers don't silently parse an error body as
// valid data (e.g. a failed getMe() turning maxBet into NaN).
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type LiteMarket = {
  id: string;
  creatorId: string;
  creatorUsername: string;
  creatorName: string;
  creatorAvatarUrl?: string;
  createdTime: number;
  closeTime?: number;
  question: string;
  url: string;
  outcomeType: string;
  mechanism: string;
  probability: number;
  pool: { outcome: number };
  p?: number;
  totalLiquidity?: number;
  volume: number;
  volume24Hours: number;
  isResolved: boolean;
  resolutionTime?: number;
  resolution?: string;
  resolutionProbability?: number;
  uniqueBettorCount: number;
  lastUpdatedTime?: number;
  lastBetTime?: number;
  token?: "MANA" | "CASH";
};

export type Bet = {
  id: string;
  userId: string;
  contractId: string;
  createdTime: number;
  amount: number;
  loanAmount?: number;
  outcome: string;
  shares: number;
  probBefore: number;
  probAfter: number;
  isSold?: boolean;
  isAnte?: boolean;
  isLiquidityProvision?: boolean;
  isRedemption?: boolean;
  userUsername: string;
  orderAmount?: number;
  limitProb?: number;
  isFilled?: boolean;
  isCancelled?: boolean;
};

export type SearchMarketsParams = {
  term?: string;
  sort?: "newest" | "score" | "most-popular" | "daily-score" | "24-hour-vol" | "liquidity" | "close-date";
  filter?: "open" | "closed" | "resolved" | "all" | "closing-week" | "closing-month" | "closing-day";
  contractType?: "BINARY" | "MULTIPLE_CHOICE" | "ALL";
  limit?: number;
  offset?: number;
  beforeTime?: number;
};

export const searchMarkets = async (params: SearchMarketsParams): Promise<LiteMarket[]> => {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query.set(k, String(v));
  }
  const markets = await fetch(`${API_URL}/search-markets?${query}`).then((res) =>
    parseJson<LiteMarket[]>(res)
  );
  return markets ?? [];
};

export const getMarkets = async (limit = 1000, before?: string): Promise<LiteMarket[]> => {
  const url = before
    ? `${API_URL}/markets?limit=${limit}&before=${before}`
    : `${API_URL}/markets?limit=${limit}`;
  const markets = await fetch(url).then((res) => parseJson<LiteMarket[]>(res));
  return markets ?? [];
};

export const getMarketById = async (id: string): Promise<LiteMarket> => {
  return fetch(`${API_URL}/market/${id}`).then((res) => parseJson<LiteMarket>(res));
};

interface BetQueryParams {
  userId?: string;
  username?: string;
  contractId?: string;
  contractSlug?: string;
  limit?: number;
  before?: string;
}

export const getBets = async (queryParams: BetQueryParams): Promise<Bet[]> => {
  const queryString = Object.entries(queryParams)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const bets = await fetch(`${API_URL}/bets?${queryString}`).then((res) =>
    parseJson<Bet[]>(res)
  );
  return bets ?? [];
};

export const placeBet = (bet: {
  contractId: string;
  outcome: "YES" | "NO";
  amount: number;
  limitProb?: number;
  expiresMillisAfter?: number;
}): Promise<Bet> => {
  return fetch(`${API_URL}/bet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${yourKey}`,
    },
    body: JSON.stringify(bet),
  }).then((res) => parseJson<Bet>(res));
};

export const cancelBet = (betId: string): Promise<Bet> => {
  return fetch(`${API_URL}/bet/cancel/${betId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${yourKey}`,
    },
  }).then((res) => parseJson<Bet>(res));
};

// Sells shares back into the CPMM. With `shares` omitted, Manifold sells the
// entire position of that outcome.
export const sellShares = (
  contractId: string,
  body: { outcome?: "YES" | "NO"; shares?: number } = {}
): Promise<Bet> => {
  return fetch(`${API_URL}/market/${contractId}/sell`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${yourKey}`,
    },
    body: JSON.stringify(body),
  }).then((res) => parseJson<Bet>(res));
};

export const getMe = async (): Promise<{ id: string; balance: number; username: string }> => {
  return fetch(`${API_URL}/me`, {
    headers: { Authorization: `Key ${yourKey}` },
  }).then((res) => parseJson<{ id: string; balance: number; username: string }>(res));
};

export const fetchAllResolvedBinaryMarkets = async (): Promise<LiteMarket[]> => {
  const all = new Map<string, LiteMarket>();
  let beforeTime: number | undefined = undefined;

  while (true) {
    const batch = await searchMarkets({
      filter: "resolved",
      contractType: "BINARY",
      sort: "newest",
      limit: 1000,
      ...(beforeTime !== undefined ? { beforeTime } : {}),
    });

    for (const m of batch) all.set(m.id, m);
    console.log(`Fetched ${all.size} resolved BINARY markets...`);

    if (batch.length < 1000) break;

    // Subtract 1ms so the next page doesn't re-fetch markets at the exact boundary timestamp
    beforeTime = batch[batch.length - 1].createdTime - 1;
  }

  return Array.from(all.values());
};
