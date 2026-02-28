import { NextRequest, NextResponse } from "next/server";
import { callNvidiaAgent } from "@/lib/nvidia-nim";
import {
  getPortfolio, placeLimitOrder,
  checkAndFillOrders, updatePositions
} from "@/lib/tools/paper-trading";
import { getTokenOHLCV, getTokenMarketData } from "@/lib/tools/screener";
import { getOrderBookLiquidity } from "@/lib/tools/liquidity";
import { generateTechnicalReport } from "@/lib/tools/technical";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WATCHLIST = [
  { symbol: "btc", coinId: "bitcoin" },
  { symbol: "eth", coinId: "ethereum" },
  { symbol: "sol", coinId: "solana" },
  { symbol: "bnb", coinId: "binancecoin" },
  { symbol: "xrp", coinId: "ripple" },
];

const LIMIT_ORDER_PROMPT = `You are FC_Agent AutoTrader using limit orders only.
Respond ONLY in JSON:
{
  "action": "BUY_LIMIT" | "SELL_LIMIT" | "SKIP",
  "limitPrice": 0.0,
  "tp1": 0.0,
  "tp2": 0.0,
  "tp3": 0.0,
  "sl": 0.0,
  "confidence": 0,
  "reason": "max 15 words"
}
Rules: confidence>=7, RR>=3:1, SL max 3%, place at OB/FVG/liquidity zones.`;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = "cron-auto-trader";
  const logs: string[] = [];
  const ts = new Date().toLocaleTimeString();
  const portfolio = getPortfolio(userId);

  logs.push(`[${ts}] 🔄 Cron — Balance:$${portfolio.balance.toFixed(2)} Positions:${portfolio.positions.length} Pending:${portfolio.pendingOrders.length}`);

  // Kumpulkan semua harga
  const allCoinIds = new Set([
    ...portfolio.positions.map((p) => p.coinId),
    ...portfolio.pendingOrders.map((o) => o.coinId),
    ...WATCHLIST.map((w) => w.coinId),
  ]);

  const priceMap: Record<string, number> = {};
  await Promise.all(
    Array.from(allCoinIds).map(async (coinId) => {
      const data = await getTokenMarketData(coinId);
      if (data?.market_data?.current_price?.usd) {
        priceMap[coinId] = data.market_data.current_price.usd;
      }
    })
  );

  // 1. Check & fill limit orders
  const { filled, expired } = checkAndFillOrders(userId, priceMap);
  filled.forEach((o) => logs.push(`[${ts}] ✅ FILLED ${o.orderType} ${o.coin} @ $${o.limitPrice}`));
  expired.forEach((o) => logs.push(`[${ts}] ⏰ EXPIRED ${o.orderType} ${o.coin} @ $${o.limitPrice}`));

  // 2. Update open positions TP/SL
  const { closed } = updatePositions(userId, priceMap);
  closed.forEach((p) => {
    const e = p.closeReason === "SL" ? "🔴" : "🟢";
    logs.push(`[${ts}] ${e} CLOSED ${p.type} ${p.coin} ${p.closeReason} PnL:$${p.pnl.toFixed(2)}`);
  });

  // 3. Scan market untuk limit order baru
  const updatedPortfolio = getPortfolio(userId);
  if (updatedPortfolio.pendingOrders.length < 5) {
    for (const coin of WATCHLIST) {
      const hasOrder = updatedPortfolio.pendingOrders.find((o) => o.coinId === coin.coinId);
      const hasPos = updatedPortfolio.positions.find((p) => p.coinId === coin.coinId);
      if (hasOrder || hasPos) continue;

      try {
        const [ohlcv, mktData, ob] = await Promise.allSettled([
          getTokenOHLCV(coin.coinId),
          getTokenMarketData(coin.coinId),
          getOrderBookLiquidity(coin.symbol.toUpperCase()),
        ]);

        const mkt = mktData.status === "fulfilled" ? mktData.value : null;
        const ohlcvData = ohlcv.status === "fulfilled" ? ohlcv.value : null;
        const currentPrice = priceMap[coin.coinId] || 0;

        if (!mkt || !ohlcvData || !currentPrice) continue;

        let taData = generateTechnicalReport(mkt.name, ohlcvData, currentPrice);
        if (ob.status === "fulfilled") taData += `\n${ob.value}`;

        const aiRes = await callNvidiaAgent(
          [{ role: "user", content: `Limit order for ${coin.symbol.toUpperCase()}USDT @ $${currentPrice}?\n${taData}` }],
          LIMIT_ORDER_PROMPT
        );

        let d: any;
        try {
          const m = aiRes.content.match(/\{[\s\S]*?\}/);
          if (m) d = JSON.parse(m[0]);
        } catch { continue; }

        if ((d?.action === "BUY_LIMIT" || d?.action === "SELL_LIMIT") && d.confidence >= 7) {
          const result = placeLimitOrder(
            userId, coin.symbol, coin.coinId,
            d.action, currentPrice,
            d.limitPrice, d.tp1, d.tp2, d.tp3, d.sl,
            d.confidence, d.reason, 10
          );
          if (result.success) {
            logs.push(`[${ts}] 📋 PLACED ${d.action} ${coin.symbol.toUpperCase()} limit:$${d.limitPrice} C:${d.confidence}/10`);
          }
        } else {
          logs.push(`[${ts}] ⏭️ SKIP ${coin.symbol.toUpperCase()} C:${d?.confidence || 0}/10`);
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        logs.push(`[${ts}] ❌ ${coin.symbol.toUpperCase()} — ${err.message}`);
      }
    }
  }

  return NextResponse.json({ success: true, logs, portfolio: getPortfolio(userId) });
}
