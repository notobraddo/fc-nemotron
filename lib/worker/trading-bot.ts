import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { getPortfolio, openPosition, updatePositions, getPortfolioSummary } from "../tools/paper-trading";
import { getTokenOHLCV, getTokenMarketData } from "../tools/screener";
import { getOrderBookLiquidity } from "../tools/liquidity";
import { generateTechnicalReport } from "../tools/technical";
import { callNvidiaAgent } from "../nvidia-nim";

const WATCHLIST = [
  { symbol: "btc", coinId: "bitcoin" },
  { symbol: "eth", coinId: "ethereum" },
  { symbol: "sol", coinId: "solana" },
  { symbol: "bnb", coinId: "binancecoin" },
  { symbol: "xrp", coinId: "ripple" },
];

const TRADING_PROMPT = `You are FC_Agent AutoTrader managing a paper trading portfolio.
Analyze market data and decide whether to open a position.

Respond ONLY in this exact JSON format:
{
  "action": "OPEN" | "SKIP",
  "type": "LONG" | "SHORT",
  "entry": 0.0,
  "tp1": 0.0,
  "tp2": 0.0,
  "tp3": 0.0,
  "sl": 0.0,
  "confidence": 0,
  "reason": "short reason"
}

Rules:
- OPEN only if confidence >= 6
- Risk/Reward minimum 1:2
- SL max 3% from entry
- If unclear, action = SKIP`;

async function analyzeMarket(symbol: string, coinId: string): Promise<string> {
  const [ohlcv, marketData, orderBook] = await Promise.allSettled([
    getTokenOHLCV(coinId),
    getTokenMarketData(coinId),
    getOrderBookLiquidity(symbol.toUpperCase()),
  ]);

  let data = `=== ${symbol.toUpperCase()}USDT ===\n`;

  const mkt = marketData.status === "fulfilled" ? marketData.value : null;
  const ohlcvData = ohlcv.status === "fulfilled" ? ohlcv.value : null;

  if (mkt && ohlcvData) {
    const price = mkt.market_data?.current_price?.usd || 0;
    const change24h = mkt.market_data?.price_change_percentage_24h?.toFixed(2);
    data += `Price: $${price} | 24h: ${change24h}%\n`;
    data += generateTechnicalReport(mkt.name, ohlcvData, price);
  }

  if (orderBook.status === "fulfilled") {
    data += `\n${orderBook.value}`;
  }

  return data;
}

async function runTradingCycle(userId: string) {
  const logs: string[] = [];
  const timestamp = new Date().toLocaleTimeString();

  logs.push(`[${timestamp}] 🤖 Starting trading cycle for user: ${userId}`);

  const portfolio = getPortfolio(userId);

  // Update harga posisi yang sudah open
  if (portfolio.positions.length > 0) {
    const priceMap: Record<string, number> = {};
    await Promise.all(
      portfolio.positions.map(async (pos) => {
        const data = await getTokenMarketData(pos.coinId);
        if (data?.market_data?.current_price?.usd) {
          priceMap[pos.coinId] = data.market_data.current_price.usd;
        }
      })
    );
    const { closed } = updatePositions(userId, priceMap);
    if (closed.length > 0) {
      closed.forEach((pos) => {
        logs.push(`[${timestamp}] ${pos.closeReason === "SL" ? "🔴" : "🟢"} CLOSED ${pos.type} ${pos.coin} — ${pos.closeReason} | PnL: $${pos.pnl.toFixed(2)}`);
      });
    }
  }

  // Scan market untuk posisi baru
  if (portfolio.positions.length < 3) {
    for (const coin of WATCHLIST) {
      const existing = portfolio.positions.find((p) => p.coinId === coin.coinId);
      if (existing) {
        logs.push(`[${timestamp}] ⏭️ SKIP ${coin.symbol.toUpperCase()} — already open`);
        continue;
      }

      try {
        const marketData = await analyzeMarket(coin.symbol, coin.coinId);
        const aiResponse = await callNvidiaAgent(
          [{ role: "user", content: `Trade ${coin.symbol.toUpperCase()}USDT?\n\n${marketData}` }],
          TRADING_PROMPT
        );

        let decision: any;
        try {
          const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) decision = JSON.parse(jsonMatch[0]);
        } catch {
          logs.push(`[${timestamp}] ⚠️ ${coin.symbol.toUpperCase()} — AI parse error`);
          continue;
        }

        if (decision?.action === "OPEN" && decision.confidence >= 6) {
          const mkt = await getTokenMarketData(coin.coinId);
          const price = mkt?.market_data?.current_price?.usd || decision.entry;

          const result = openPosition(
            userId,
            coin.symbol,
            coin.coinId,
            decision.type,
            price,
            decision.tp1,
            decision.tp2,
            decision.tp3,
            decision.sl,
            10
          );

          if (result.success) {
            logs.push(`[${timestamp}] ✅ OPENED ${decision.type} ${coin.symbol.toUpperCase()} @ $${price} | C:${decision.confidence}/10 | ${decision.reason}`);
          } else {
            logs.push(`[${timestamp}] ❌ FAILED ${coin.symbol.toUpperCase()} — ${result.message}`);
          }
        } else {
          logs.push(`[${timestamp}] ⏭️ SKIP ${coin.symbol.toUpperCase()} — C:${decision?.confidence || 0}/10 | ${decision?.reason || "Low confidence"}`);
        }
      } catch (err: any) {
        logs.push(`[${timestamp}] ❌ ERROR ${coin.symbol.toUpperCase()} — ${err.message}`);
      }
    }
  } else {
    logs.push(`[${timestamp}] ⏸️ Max positions reached (3/3), skip scan`);
  }

  return logs;
}

// Worker thread logic
if (!isMainThread) {
  const { userId } = workerData;
  const INTERVAL = 5 * 60 * 1000; // 5 menit

  async function tick() {
    try {
      const logs = await runTradingCycle(userId);
      parentPort?.postMessage({ type: "logs", logs });
      parentPort?.postMessage({ type: "portfolio", portfolio: getPortfolio(userId) });
    } catch (err: any) {
      parentPort?.postMessage({ type: "error", message: err.message });
    }
  }

  // Jalankan pertama kali langsung
  tick();

  // Lalu setiap 5 menit
  setInterval(tick, INTERVAL);

  parentPort?.postMessage({ type: "started", message: `Bot started, cycle every 5 minutes` });
}
