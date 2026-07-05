# "Coin Flip" Trader

A [Manifold Markets](https://manifold.markets) bot that exploits **resolution bias**. "Coin flip" refers to the 50% starting price of a fresh binary market — nothing is actually random.

It bets on brand-new binary markets (volume 0, price ≈ 50%) before anyone else has priced them, using two signals:

- **Creator bias** — some users historically resolve their own markets YES (or NO) far more often than chance. When a biased creator posts a fresh market, the bot bets toward their historical lean.
- **Phrase bias** — certain question-text phrases correlate with YES/NO resolution across many creators. The bot bets on those patterns too.

When both signals fire and agree, it sizes off the creator's (person-specific) confidence interval. When they disagree, it skips the market.

No coins are flipped (if the question-making power users haven't noticed yet), this bot is a lie.

## Setup

Create a `.env` file in the project root:

```
MANIFOLD_API_KEY=your-key-here
MANIFOLD_USERNAME=your-bot-username
```

Then install dependencies:

```
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the trading bot. Polls for new binary markets every 30s and bets on qualifying ones. Also claims the free daily loan once per day. |
| `npm run build-targets` | Rebuilds `new_targets.json` — the per-creator YES/NO bias table — from all resolved binary markets on Manifold. Takes a few minutes. |
| `npm run analyze-phrases` | Rebuilds `phrase_targets.json` — the high-confidence phrase-bias table. Prints the top biased phrases as it goes. |
| `npm run analyze-pnl` | Joins `bet_log.jsonl` against current market resolutions and reports realized ROI by strategy source and by label. Use it to see which signals actually make money. |
| `npm run sell-positions` | Reviews open positions and flags ones whose originating signal has been retired since you placed them. **Dry run** — only reports. |
| `npm run pipeline` | Runs `build-targets` → `analyze-phrases` → `start` in sequence, so the bot launches with freshly rebuilt target files. |
| `npm run format` | Prettier over the whole repo. |

### Flags

- **Choose strategies:** `npm start -- --strategies=creator` (or `phrase`, or `creator,phrase`). Defaults to both.
- **Actually sell:** `npm run sell-positions -- --execute` sells the flagged positions. Without `--execute` it only reports.

## Typical workflow

```
npm run pipeline            # rebuild targets, then start trading
npm run analyze-pnl         # later: check how each signal is performing
npm run sell-positions      # after a pipeline run: see positions on retired signals
```

`build-targets` and `analyze-phrases` write their results to disk; the bot only loads those files at startup, so **restart the bot (or use `pipeline`) after rebuilding** to pick up new targets.

## Risk controls

- Never bets more than **2% of current balance** on a single market (checked live each poll).
- Every bet is placed as a **limit order at the target price**, so bad sizing math can't overshoot.
- Skips signals within 10% of 50/50 (not enough edge) and markets closing more than a year out (capital lock-up).
- Every bet is appended to `bet_log.jsonl` for later analysis.
- Claims the free daily loan (interest-free, auto-repaid from resolutions) once per day to keep capital working. Note this adds leverage: `me.balance` includes borrowed mana, so the 2% cap sizes off a loan-inflated balance.

## Data files

- `new_targets.json` — per-creator bias table (generated).
- `phrase_targets.json` — phrase bias table (generated).
- `bet_log.jsonl` — append-only log of every bet placed.

## Caveats

Confidence intervals use the Wilson score interval to avoid degenerate bounds on small samples, and phrase mining excludes markets whose deadline hasn't passed yet (to avoid survivorship bias).

That said: yes, the code started out bad (I'm a mediocre coder who doesn't really know JavaScript), and yes I'm aware of sample bias — it's still a for-fun play-money bot where multiple-comparisons risk and thin-market weirdness very much apply. Without the API fee I'd also have bet 1 mana "No" on every low-sample question maker, since they resolve ~47% No. I'm just having fun here. Trade at your own amusement.
