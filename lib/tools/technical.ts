// CoinGecko OHLC format: [timestamp, open, high, low, close]
// Index:                      0         1     2    3    4

export function calculateRSI(closes: number[], period = 14): number {
  if (!closes || closes.length < period + 1) return 50; // default netral

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

export function calculateMA(closes: number[], period: number): number {
  if (!closes || closes.length < period) return closes?.[closes.length - 1] ?? 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateEMA(closes: number[], period: number): number {
  if (!closes || closes.length < period) return closes?.[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(6));
}

export interface SMCAnalysis {
  trend: "Bullish" | "Bearish" | "Sideways";
  bos: string;
  choch: string;
  orderBlocks: string;
  fvg: string;
  liquidity: string;
}

export function analyzeSMC(ohlcv: number[][]): SMCAnalysis {
  const empty: SMCAnalysis = {
    trend: "Sideways",
    bos: "Data tidak cukup",
    choch: "Data tidak cukup",
    orderBlocks: "Data tidak cukup",
    fvg: "Data tidak cukup",
    liquidity: "Data tidak cukup",
  };

  if (!ohlcv || ohlcv.length < 10) return empty;

  // CoinGecko format: [timestamp, open, high, low, close]
  const highs = ohlcv.map((c) => c[2]);
  const lows = ohlcv.map((c) => c[3]);
  const closes = ohlcv.map((c) => c[4]);

  if (highs.some(isNaN) || lows.some(isNaN) || closes.some(isNaN)) return empty;

  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const prevHigh = Math.max(...highs.slice(-10, -5));
  const prevLow = Math.min(...lows.slice(-10, -5));
  const currentClose = closes[closes.length - 1];

  let trend: "Bullish" | "Bearish" | "Sideways";
  if (recentHigh > prevHigh && recentLow > prevLow) trend = "Bullish";
  else if (recentHigh < prevHigh && recentLow < prevLow) trend = "Bearish";
  else trend = "Sideways";

  const bos = recentHigh > prevHigh
    ? `✅ BOS Bullish — break high $${prevHigh.toFixed(4)}`
    : recentLow < prevLow
    ? `✅ BOS Bearish — break low $${prevLow.toFixed(4)}`
    : "⏳ Belum ada BOS signifikan";

  const choch = (trend === "Bullish" && currentClose < recentLow)
    ? "⚠️ CHoCH — potensi reversal Bearish"
    : (trend === "Bearish" && currentClose > recentHigh)
    ? "⚠️ CHoCH — potensi reversal Bullish"
    : "✅ Tidak ada CHoCH";

  const bullishOB = lows[Math.max(lows.length - 4, 0)].toFixed(4);
  const bearishOB = highs[Math.max(highs.length - 4, 0)].toFixed(4);
  const orderBlocks = `🟢 Demand OB: ~$${bullishOB} | 🔴 Supply OB: ~$${bearishOB}`;

  const lastClose = closes[closes.length - 1];
  const threeBack = closes[Math.max(closes.length - 4, 0)];
  const fvgPct = Math.abs((lastClose - threeBack) / threeBack * 100).toFixed(2);
  const fvg = parseFloat(fvgPct) > 1.5
    ? `⚡ FVG ${fvgPct}% — kemungkinan di-fill`
    : "✅ Tidak ada FVG signifikan";

  const liquidity = trend === "Bullish"
    ? `💧 Liquidity pool di bawah: $${recentLow.toFixed(4)}`
    : `💧 Liquidity pool di atas: $${recentHigh.toFixed(4)}`;

  return { trend, bos, choch, orderBlocks, fvg, liquidity };
}

export function generateTechnicalReport(
  coinName: string,
  ohlcv: number[][],
  currentPrice: number
): string {
  if (!ohlcv || ohlcv.length < 15) {
    return `⚠️ Data OHLCV tidak cukup untuk ${coinName} (${ohlcv?.length || 0} candles)`;
  }

  // CoinGecko format: [timestamp, open, high, low, close]
  const closes = ohlcv.map((c) => c[4]).filter((v) => !isNaN(v));

  if (closes.length < 15) {
    return `⚠️ Data closes tidak valid untuk ${coinName}`;
  }

  const rsi = calculateRSI(closes);
  const ma7 = calculateMA(closes, 7);
  const ma25 = calculateMA(closes, Math.min(25, closes.length));
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, Math.min(21, closes.length));
  const smc = analyzeSMC(ohlcv);

  const rsiSignal = rsi >= 70 ? "🔴 Overbought" :
                    rsi <= 30 ? "🟢 Oversold" :
                    rsi >= 55 ? "🟡 Bullish momentum" :
                    rsi <= 45 ? "🟡 Bearish momentum" : "⚪ Netral";

  const maSignal = ma7 > ma25 ? "🟢 Bullish (MA7 > MA25)" : "🔴 Bearish (MA7 < MA25)";
  const emaSignal = ema9 > ema21 ? "🟢 Bullish (EMA9 > EMA21)" : "🔴 Bearish (EMA9 < EMA21)";

  let score = 0;
  if (rsi > 50) score++;
  if (rsi < 50) score--;
  if (ma7 > ma25) score++;
  if (ma7 < ma25) score--;
  if (ema9 > ema21) score++;
  if (ema9 < ema21) score--;
  if (smc.trend === "Bullish") score++;
  if (smc.trend === "Bearish") score--;

  const overall = score >= 2 ? "🟢 BULLISH BIAS" :
                  score <= -2 ? "🔴 BEARISH BIAS" : "🟡 SIDEWAYS";

  return `📊 TA: ${coinName} @ $${currentPrice.toLocaleString()}

SMC: ${smc.trend}
${smc.bos}
${smc.choch}
${smc.orderBlocks}
${smc.fvg}
${smc.liquidity}

MA7: $${ma7.toFixed(4)} | MA25: $${ma25.toFixed(4)}
${maSignal}
EMA9: $${ema9.toFixed(4)} | EMA21: $${ema21.toFixed(4)}
${emaSignal}

RSI(14): ${rsi} — ${rsiSignal}

Overall: ${overall}`;
}
