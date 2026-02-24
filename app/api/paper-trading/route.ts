import { NextRequest, NextResponse } from "next/server";
import { callNvidiaAgent } from "@/lib/nvidia-nim";
import { getPortfolio, getPortfolioSummary, openPosition, updatePositions, resetPortfolio } from "@/lib/tools/paper-trading";
import { getTokenOHLCV, getTokenMarketData, screenTokens } from "@/lib/tools/screener";
import { getOrderBookLiquidity, getLiquidationLevels } from "@/lib/tools/liquidity";
import { generateTechnicalReport } from "@/lib/tools/technical";
import { searchCoinId } from "@/lib/tools/coingecko";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TRADING_PROMPT = `You are FC_Agent AutoTrader. You manage a $1000 paper trading portfolio.

Analyze the market data and decide whether to open a position.

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
- OPEN only if confidence >= 6/10
- Risk/Reward must be at least 1:2
- SL max 3% from entry for scalp, 5% for swing
- If market unclear or sideways, action = SKIP
- Base decision on real data provided`;

// Coins yang di-monitor untuk auto trading
const WATCHLIST = [
  { symbol: "btc", coinId: "bitcoin" },
  { symbol: "eth", coinId: "ethereum" },
  { symbol: "sol", coinId: "solana" },
  { symbol: "bnb", coinId: "binancecoin" },
  { symbol: "xrp", coinId: "ripple" },
];

async function analyzeForTrade(symbol: string, coinId: string) {
  const [ohlcv, marketData, orderBook] = await Promise.allSettled([
    getTokenOHLCV(coinId),
    getTokenMarketData(coinId),
    getOrderBookLiquidity(symbol.toUpperCase()),
  ]);

  let data = `=== ${symbol.toUpperCase()} MARKET DATA ===\n`;

  const mktData = marketData.status === "fulfilled" ? marketData.value : null;
  const ohlcvData = ohlcv.status === "fulfilled" ? ohlcv.value : null;

  if (mktData && ohlcvData) {
    const price = mktData.market_data?.current_price?.usd || 0;
    const change24h = mktData.market_data?.price_change_percentage_24h?.toFixed(2);
    data += `Price: $${price} | 24h: ${change24h}%\n`;
    data += generateTechnicalReport(mktData.name, ohlcvData, price);
  }

  if (orderBook.status === "fulfilled") {
    data += `\n${orderBook.value}`;
  }

  return data;
}

// GET — ambil portfolio & update posisi
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") || "default";

  // Update semua open positions dengan harga terkini
  const portfolio = getPortfolio(userId);

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
    updatePositions(userId, priceMap);
  }

  const summary = getPortfolioSummary(userId);
  const updatedPortfolio = getPortfolio(userId);

  return NextResponse.json({
    summary,
    portfolio: {
      balance: updatedPortfolio.balance,
      positions: updatedPortfolio.positions,
      closedTrades: updatedPortfolio.closedTrades.slice(0, 20),
      pnlHistory: updatedPortfolio.pnlHistory.slice(-50),
      totalTrades: updatedPortfolio.totalTrades,
      wins: updatedPortfolio.wins,
      losses: updatedPortfolio.losses,
      winRate: updatedPortfolio.winRate,
      totalPnl: updatedPortfolio.totalPnl,
      initialBalance: updatedPortfolio.initialBalance,
    },
  });
}

// POST — AI auto trade
export async function POST(req: NextRequest) {
  const { userId, action } = await req.json();

  if (action === "reset") {
    resetPortfolio(userId);
    return NextResponse.json({ success: true, message: "Portfolio direset ke $1000" });
  }

  if (action === "auto_trade") {
    const portfolio = getPortfolio(userId);
    const results: any[] = [];

    // Scan watchlist
    for (const coin of WATCHLIST) {
      // Skip kalau sudah ada posisi untuk coin ini
      const existing = portfolio.positions.find((p) => p.coinId === coin.coinId);
      if (existing) {
        results.push({ coin: coin.symbol, action: "SKIP", reason: "Already has open position" });
        continue;
      }

      try {
        const marketData = await analyzeForTrade(coin.symbol, coin.coinId);

        // Minta AI untuk analisis
        const aiResponse = await callNvidiaAgent(
          [{ role: "user", content: `Should I trade ${coin.symbol.toUpperCase()}USDT?\n\n${marketData}` }],
          TRADING_PROMPT
        );

        // Parse JSON response
        let decision: any;
        try {
          const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            decision = JSON.parse(jsonMatch[0]);
          }
        } catch {
          results.push({ coin: coin.symbol, action: "SKIP", reason: "AI parse error" });
          continue;
        }

        if (decision?.action === "OPEN" && decision.confidence >= 6) {
          // Get current price
          const mktData = await getTokenMarketData(coin.coinId);
          const currentPrice = mktData?.market_data?.current_price?.usd || decision.entry;

          const result = openPosition(
            userId,
            coin.symbol,
            coin.coinId,
            decision.type,
            currentPrice,
            decision.tp1,
            decision.tp2,
            decision.tp3,
            decision.sl,
            10 // 10% per trade
          );

          results.push({
            coin: coin.symbol,
            action: "OPEN",
            type: decision.type,
            entry: currentPrice,
            tp1: decision.tp1,
            tp2: decision.tp2,
            tp3: decision.tp3,
            sl: decision.sl,
            confidence: decision.confidence,
            reason: decision.reason,
            success: result.success,
            message: result.message,
          });
        } else {
          results.push({
            coin: coin.symbol,
            action: "SKIP",
            confidence: decision?.confidence || 0,
            reason: decision?.reason || "Low confidence",
          });
        }
      } catch (error: any) {
        results.push({ coin: coin.symbol, action: "ERROR", reason: error.message });
      }
    }

    return NextResponse.json({ results, portfolio: getPortfolio(userId) });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
