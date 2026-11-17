# Dip-Reversion BTC Bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/ChristaNavisa/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/ChristaNavisa/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A trading bot for the make.fun BTC race: it trades Coinbase Wrapped BTC
(cbBTC) against USDC, one minute at a time, on 1-minute on-chain bars from
the Orca Whirlpool, starting from $1,000 of paper money, long only.

## Strategy

One-minute cbBTC closes mean-revert around their 2-hour average. The bot
keeps the log closes and a 120-bar moving average of them, and measures
`z`, the close's deviation from that average in basis points:

- **Buy** 75% of cash when `z < -60` and the 240-bar trend is not falling
  faster than -80 bps (the trend filter is the falling-knife guard).
- **Sell** the whole position when `z > +35`.
- No stop-loss and no time stop: on the dev window both cut winners more
  than losers.

A full-size round trip pays about 26-35 bps in fees (4 bps), slippage
(2 bps) and price impact against the pool, so the bot only trades a dip
deep enough to clear that cost.

## Local result (dev window)

Graded locally with the kit's own grader
(`node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process`):

- Net PnL: **+$8.42** on the frozen 24h dev window (1,440 bars)
- Trades: 8 (4 round trips), win rate 75%, maximum drawdown 0.8%
- Net PnL at 2x fees: +$6.01 — the edge survives doubled costs
- Deterministic: two runs produce byte-identical action logs

## Run

The entrypoint is `main.ts` (Node 22, standard library only). It speaks
`agent-fun/bars-replay/v1` on stdin/stdout: one JSON line per batch, one
reply per batch. No network, no wall clock, no files outside the repo, no
randomness — its orders are a pure function of the batches it was sent.

## License

MIT. See [LICENSE](LICENSE).
