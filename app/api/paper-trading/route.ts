import { NextRequest, NextResponse } from "next/server";
import { callNvidiaAgent } from "@/lib/nvidia-nim";
import {
  getPortfolio, getPortfolioSummary,
  placeLimitOrder, cancelOrder,
  checkAndFillOrders, updatePositions,
  resetPortfolio
} from "@/lib/tools/paper-trading";
import { getTokenOHLCV, getTokenMarketData } from "@/lib/tools/screener";
import { getOrderBookLiquidity, getLiquidationLevels } from "@/lib/tools/liquidity";
import { generateTechnicalReport } from "@/lib/tools/technical";
import { searchCoinId } from "@/lib/tools/coingecko";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WATCHLIST = [
  { symbol: "btc", coinId: "bitcoin" },
  { symbol: "eth", coinId: "ethereum" },
  { symbol: "sol", coinId: "solana" },
  { symbol: "bnb", coinId: "binancecoin" },
  { symbol: "xrp", coinId: "ripple" },
];

const LIMIT_ORDER_PROMPT = `You are FC_Agent, a professional crypto trader using limit orders.

Analyze the market data and decide the BEST limit order entry.

Rules:
- BUY_LIMIT: place below current price at key support/demand zone (0.5%-3% below)
- SELL_LIMIT: place above current price at key resistance/supply zone (0.5%-3% above)
- Only open if confidence >= 7
- Risk/Reward minimum 1:3
- SL max 3% from limit price
- Place limit at order blocks, FVG zones, or liquidity pools

Respond ONLY in this exact JSON:
{
  "action": "BUY_LIMIT" | "SELL_LIMIT" | "SKIP",
  "limitPrice": 0.0,
  "tp1": 0.0,
  "tp2": 0.0,
  "tp3": 0.0,
  "sl": 0.0,
  "confidence": 0,
  "reason": "why this level (max 20 words)"
}`;

async function analyzeForLimitOrder(symbol: string, coinId: string): Promise<string> {
  const [ohlcv, marketData, orderBook, liquidation] = await Promise.allSettled([
    getTokenOHLCV(coinId),
    getTokenMarketData(coinId),
    getOrderBookLiquidity(symbol.toUpperCase()),
    getLiquidationLevels(symbol.toUpperCase()),
  ]);

  let data = `=== ${symbol.toUpperCase()}USDT ===\n`;

  const mkt = marketData.status === "fulfilled" ? marketData.value : null;
  const ohlcvData = ohlcv.status === "fulfilled" ? ohlcv.value : null;

  if (mkt && ohlcvData) {
    const price = mkt.market_data?.current_price?.usd || 0;
    const change24h = mkt.market_data?.price_change_percentage_24h?.toFixed(2);
    const vol = mkt.market_data?.total_volume?.usd
      ? `$${(mkt.market_data.total_volume.usd / 1e6).toFixed(0)}M`
      : "N/A";
    data += `Price: $${price} | 24h: ${change24h}% | Vol: ${vol}\n`;
    data += generateTechnicalReport(mkt.name, ohlcvData, price);
  }

  if (orderBook.status === "fulfilled") data += `\n${orderBook.value}`;
  if (liquidation.status === "fulfilled") data += `\n${liquidation.value}`;

  return data;
}

// GET — ambil portfolio & update
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") || "default";
  const portfolio = getPortfolio(userId);

  // Kumpulkan semua coinId yang perlu di-update harganya
  const allCoinIds = new Set([
    ...portfolio.positions.map((p) => p.coinId),
    ...portfolio.pendingOrders.map((o) => o.coinId),
  ]);

  const priceMap: Record<string, number> = {};
  if (allCoinIds.size > 0) {
    await Promise.all(
      Array.from(allCoinIds).map(async (coinId) => {
        const data = await getTokenMarketData(coinId);
        if (data?.market_data?.current_price?.usd) {
          priceMap[coinId] = data.market_data.current_price.usd;
        }
      })
    );

    // Check & fill limit orders dulu
    checkAndFillOrders(userId, priceMap);

    // Update open positions
    updatePositions(userId, priceMap);
  }

  const summary = getPortfolioSummary(userId);
  const updated = getPortfolio(userId);

  return NextResponse.json({
    summary,
    portfolio: {
      balance: updated.balance,
      reservedBalance: updated.reservedBalance,
      initialBalance: updated.initialBalance,
      positions: updated.positions,
      pendingOrders: updated.pendingOrders,
      closedTrades: updated.closedTrades.slice(0, 30),
      cancelledOrders: updated.cancelledOrders.slice(0, 10),
      pnlHistory: updated.pnlHistory.slice(-100),
      totalTrades: updated.totalTrades,
      wins: updated.wins,
      losses: updated.losses,
      winRate: updated.winRate,
      totalPnl: updated.totalPnl,
    },
  });
}

// POST — AI scan & place limit orders
export async function POST(req: NextRequest) {
  const { userId, action, orderId } = await req.json();

  if (action === "reset") {
    resetPortfolio(userId);
    return NextResponse.json({ success: true, message: "Portfolio direset ke $1000" });
  }

  if (action === "cancel_order") {
    const result = cancelOrder(userId, orderId);
    return NextResponse.json(result);
  }

  if (action === "auto_trade") {
    const results: any[] = [];
    const portfolio = getPortfolio(userId);

    for (const coin of WATCHLIST) {
      // Skip kalau sudah ada order/posisi
      const hasOrder = portfolio.pendingOrders.find((o) => o.coinId === coin.coinId);
      const hasPos = portfolio.positions.find((p) => p.coinId === coin.coinId);

      if (hasOrder || hasPos) {
        results.push({ coin: coin.symbol, action: "SKIP", reason: "Already has order/position" });
        continue;
      }

      try {
        const marketData = await analyzeForLimitOrder(coin.symbol, coin.coinId);
        const mkt = await getTokenMarketData(coin.coinId);
        const currentPrice = mkt?.market_data?.current_price?.usd || 0;

        if (!currentPrice) {
          results.push({ coin: coin.symbol, action: "SKIP", reason: "No price data" });
          continue;
        }

        const aiResponse = await callNvidiaAgent(
          [{ role: "user", content: `Place limit order for ${coin.symbol.toUpperCase()}USDT?\n\n${marketData}` }],
          LIMIT_ORDER_PROMPT
        );

        let decision: any;
        try {
          const match = aiResponse.content.match(/\{[\s\S]*?\}/);
          if (match) decision = JSON.parse(match[0]);
        } catch {
          results.push({ coin: coin.symbol, action: "SKIP", reason: "AI parse error" });
          continue;
        }

        if (
          (decision?.action === "BUY_LIMIT" || decision?.action === "SELL_LIMIT") &&
          decision.confidence >= 7
        ) {
          const result = placeLimitOrder(
            userId,
            coin.symbol,
            coin.coinId,
            decision.action,
            currentPrice,
            decision.limitPrice,
            decision.tp1,
            decision.tp2,
            decision.tp3,
            decision.sl,
            decision.confidence,
            decision.reason,
            10
          );

          results.push({
            coin: coin.symbol,
            action: decision.action,
            currentPrice,
            limitPrice: decision.limitPrice,
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

        // Delay antar coin
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        results.push({ coin: coin.symbol, action: "ERROR", reason: err.message });
      }
    }

    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
