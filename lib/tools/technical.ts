// Technical Analysis: SMC, Moving Average, RSI

// ==================== RSI ====================
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

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
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ==================== Moving Average ====================
export function calculateMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// ==================== SMC (Smart Money Concepts) ====================
export interface SMCAnalysis {
  trend: "Bullish" | "Bearish" | "Sideways";
  bos: string;        // Break of Structure
  choch: string;      // Change of Character
  orderBlocks: string;
  fvg: string;        // Fair Value Gap
  liquidity: string;
}

export function analyzeSMC(ohlcv: number[][]): SMCAnalysis {
  if (!ohlcv || ohlcv.length < 10) {
    return {
      trend: "Sideways",
      bos: "Data tidak cukup",
      choch: "Data tidak cukup",
      orderBlocks: "Data tidak cukup",
      fvg: "Data tidak cukup",
      liquidity: "Data tidak cukup",
    };
  }

  const highs = ohlcv.map((c) => c[2]);  // high
  const lows = ohlcv.map((c) => c[3]);   // low
  const closes = ohlcv.map((c) => c[4]); // close

  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const prevHigh = Math.max(...highs.slice(-10, -5));
  const prevLow = Math.min(...lows.slice(-10, -5));
  const currentClose = closes[closes.length - 1];

  // Trend detection
  let trend: "Bullish" | "Bearish" | "Sideways";
  if (recentHigh > prevHigh && recentLow > prevLow) trend = "Bullish";
  else if (recentHigh < prevHigh && recentLow < prevLow) trend = "Bearish";
  else trend = "Sideways";

  // Break of Structure
  const bos = recentHigh > prevHigh
    ? `✅ BOS Bullish — harga break high sebelumnya ($${prevHigh.toFixed(4)})`
    : recentLow < prevLow
    ? `✅ BOS Bearish — harga break low sebelumnya ($${prevLow.toFixed(4)})`
    : "⏳ Belum ada BOS yang signifikan";

  // Change of Character
  const choch = trend === "Bullish" && currentClose < recentLow
    ? `⚠️ CHoCH terdeteksi — potensi reversal ke Bearish`
    : trend === "Bearish" && currentClose > recentHigh
    ? `⚠️ CHoCH terdeteksi — potensi reversal ke Bullish`
    : "✅ Tidak ada CHoCH, trend masih konsisten";

  // Order Blocks (area supply/demand)
  const bullishOB = lows[lows.length - 3].toFixed(4);
  const bearishOB = highs[highs.length - 3].toFixed(4);
  const orderBlocks = `🟢 Bullish OB (Demand): ~$${bullishOB}\n   🔴 Bearish OB (Supply): ~$${bearishOB}`;

  // Fair Value Gap
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 3];
  const fvgSize = Math.abs(lastClose - prevClose);
  const fvgPercent = ((fvgSize / prevClose) * 100).toFixed(2);
  const fvg = fvgSize > prevClose * 0.02
    ? `⚡ FVG terdeteksi — gap ${fvgPercent}% kemungkinan akan di-fill`
    : "✅ Tidak ada FVG signifikan";

  // Liquidity
  const liquidity = trend === "Bullish"
    ? `💧 Liquidity di bawah low: $${recentLow.toFixed(4)} (target sweep sebelum naik)`
    : `💧 Liquidity di atas high: $${recentHigh.toFixed(4)} (target sweep sebelum turun)`;

  return { trend, bos, choch, orderBlocks, fvg, liquidity };
}

// ==================== Full Technical Report ====================
export function generateTechnicalReport(
  coinName: string,
  ohlcv: number[][],
  currentPrice: number
): string {
  if (!ohlcv || ohlcv.length < 15) {
    return `❌ Data OHLCV tidak cukup untuk analisis ${coinName}`;
  }

  const closes = ohlcv.map((c) => c[4]);

  // Calculate indicators
  const rsi = calculateRSI(closes);
  const ma7 = calculateMA(closes, 7);
  const ma25 = calculateMA(closes, 25);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const smc = analyzeSMC(ohlcv);

  // RSI Signal
  const rsiSignal = rsi >= 70 ? "🔴 Overbought — potensi reversal turun" :
                    rsi <= 30 ? "🟢 Oversold — potensi reversal naik" :
                    rsi >= 55 ? "🟡 Bullish momentum" :
                    rsi <= 45 ? "🟡 Bearish momentum" : "⚪ Netral";

  // MA Signal
  const maSignal = ma7 > ma25
    ? "🟢 Bullish — MA7 di atas MA25 (Golden Cross)"
    : "🔴 Bearish — MA7 di bawah MA25 (Death Cross)";

  const emaSignal = ema9 > ema21
    ? "🟢 Bullish — EMA9 di atas EMA21"
    : "🔴 Bearish — EMA9 di bawah EMA21";

  // Overall Signal
  let bullCount = 0;
  if (rsi < 50) bullCount--;
  if (rsi > 50) bullCount++;
  if (ma7 > ma25) bullCount++;
  if (ema9 > ema21) bullCount++;
  if (smc.trend === "Bullish") bullCount++;
  if (smc.trend === "Bearish") bullCount--;

  const overall = bullCount >= 2 ? "🟢 BULLISH BIAS" :
                  bullCount <= -2 ? "🔴 BEARISH BIAS" : "🟡 SIDEWAYS / NETRAL";

  return `📊 Technical Analysis: ${coinName.toUpperCase()}
💵 Current Price: $${currentPrice.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━
🧠 SMC (Smart Money Concepts)
━━━━━━━━━━━━━━━━━━━━
📍 Trend: ${smc.trend}
📍 ${smc.bos}
📍 ${smc.choch}
📍 Order Blocks:
   ${smc.orderBlocks}
📍 ${smc.fvg}
📍 ${smc.liquidity}

━━━━━━━━━━━━━━━━━━━━
📉 Moving Average
━━━━━━━━━━━━━━━━━━━━
📍 MA7: $${ma7.toFixed(4)} | MA25: $${ma25.toFixed(4)}
📍 ${maSignal}
📍 EMA9: $${ema9.toFixed(4)} | EMA21: $${ema21.toFixed(4)}
📍 ${emaSignal}

━━━━━━━━━━━━━━━━━━━━
📊 RSI (14)
━━━━━━━━━━━━━━━━━━━━
📍 RSI: ${rsi.toFixed(2)}
📍 ${rsiSignal}

━━━━━━━━━━━━━━━━━━━━
🎯 OVERALL SIGNAL
━━━━━━━━━━━━━━━━━━━━
${overall}

⚠️ DYOR — Ini bukan financial advice!`;
}
