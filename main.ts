// Dip-reversion bot for the make.fun BTC race (agent-fun/bars-replay/v1).
//
// The bot speaks the bars-replay protocol on stdin/stdout: it reads one JSON
// line per batch (hello once, then one batch per minute bar, then done) and
// answers every batch with exactly one reply echoing its seq.
//
// Strategy, fitted on the published 24h dev window of 1-minute cbBTC/USDC
// bars (offline replay with the harness's own fill math: 4 bps fee, 2 bps
// slippage, constant-product impact against the bar's open depth):
//
//   One-minute cbBTC closes mean-revert around their 2-hour average: the
//   60-minute forward return after a close 40-60 bps below its 120-bar mean
//   averaged about +18 bps, while closes above the mean drifted down. A
//   full-size round trip costs about 26-35 bps, so the bot only trades a
//   dip deep enough to clear that cost, and only when the longer trend is
//   not falling away underneath it.
//
//   - Keep the log closes and a 120-bar simple moving average of them.
//   - z = (log close - log SMA120) in basis points.
//   - Flat and z < -60 and the 240-bar log return is not worse than -80 bps:
//     buy 75% of cash (one order).
//   - Long and z > +35: sell the whole position (one order).
//   - No stop-loss and no time stop: both cut winners more than losers on
//     the dev window. The trend filter is the falling-knife guard.
//
// Money is BigInt micro-USDC (quote_scale 6); quantities are BigInt base
// units of cbBTC (qty_scale 8). The signal math is float64 logs of integer
// closes. The bot is deterministic: no clock, no environment, no
// randomness, no files - its orders are a pure function of the batches it
// was sent, so two runs on the same data answer identically.

import { createInterface } from "node:readline";

const SYMBOL = "CBBTC";
const LOOKBACK = 120; // bars in the moving average of log closes
const BUY_BELOW_BPS = -60; // buy when the close sits this far below its mean
const SELL_ABOVE_BPS = 35; // sell once the close is back this far above it
const TREND_BARS = 240; // bars in the longer-trend filter
const TREND_FLOOR_BPS = -80; // skip the buy while the trend falls past this
const BUY_FRACTION_NUM = 3n; // buy this share of cash (3/4)
const BUY_FRACTION_DEN = 4n;
const MAX_SLIPPAGE_BPS = 300; // 3%: far above any one-minute move + impact
const MIN_NOTIONAL = 1000000n; // 1 USDC, in micro-USDC

type Order = {
  side: "buy" | "sell";
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
};

const closes: number[] = []; // log closes, one per bar seen
let logSum = 0; // running sum of the log closes in the window
let warmupBars = 0;
let orderSeq = 0;

function decide(cash: bigint, qty: bigint): Order[] {
  const n = closes.length;
  if (n < LOOKBACK) return [];
  // Drop closes older than the window from the running sum.
  while (closes.length > LOOKBACK) {
    logSum -= closes.shift() as number;
  }
  const mean = logSum / LOOKBACK;
  const last = closes[closes.length - 1];
  const z = (last - mean) * 10000; // deviation from the mean, in bps

  if (qty === 0n) {
    if (z < BUY_BELOW_BPS) {
      if (n >= TREND_BARS + 1) {
        const trend = (last - closes[n - TREND_BARS - 1]) * 10000;
        if (trend < TREND_FLOOR_BPS) return [];
      }
      const notional = (cash * BUY_FRACTION_NUM) / BUY_FRACTION_DEN;
      if (notional < MIN_NOTIONAL || notional > cash) return [];
      orderSeq += 1;
      return [
        {
          side: "buy",
          client_id: `b${orderSeq}`,
          symbol: SYMBOL,
          notional_quote_units: notional.toString(),
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  }

  if (z > SELL_ABOVE_BPS) {
    orderSeq += 1;
    return [
      {
        side: "sell",
        client_id: `s${orderSeq}`,
        symbol: SYMBOL,
        qty: qty.toString(),
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  }
  return [];
}

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as {
      type: string;
      seq?: number;
      warmup_bars?: number;
      bars?: { symbol: string; c: string }[];
      account?: {
        cash_quote_units: string;
        positions: { symbol: string; qty: string }[];
      };
    };
    if (msg.type === "hello") {
      warmupBars = msg.warmup_bars ?? 0;
      continue;
    }
    if (msg.type === "done") {
      break;
    }
    if (msg.type !== "batch" || msg.seq === undefined || !msg.account) {
      continue;
    }
    const bar = msg.bars?.find((b) => b.symbol === SYMBOL);
    if (bar) {
      const logClose = Math.log(Number(bar.c));
      closes.push(logClose);
      logSum += logClose;
    }
    const cash = BigInt(msg.account.cash_quote_units);
    const pos = msg.account.positions.find((p) => p.symbol === SYMBOL);
    const qty = pos ? BigInt(pos.qty) : 0n;
    const orders = msg.seq < warmupBars ? [] : decide(cash, qty);
    process.stdout.write(
      JSON.stringify({ type: "reply", seq: msg.seq, orders }) + "\n",
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`bot failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
