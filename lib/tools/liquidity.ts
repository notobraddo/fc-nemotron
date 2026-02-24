interface Level {
  price: number;
  quantity: number;
  usdValue: number;
}

function parseLevels(orders: [string, string][]): Level[] {
  return orders
    .slice(0, 50)
    .map(([price, qty]) => {
      const p = parseFloat(price);
      const q = parseFloat(qty);
      if (isNaN(p) || isNaN(q)) return null;
      return { price: p, quantity: q, usdValue: p * q };
    })
    .filter(Boolean) as Level[];
}

function findWalls(levels: Level[], topN = 5): Level[] {
  if (levels.length === 0) return [];
  const avg = levels.reduce((s, l) => s + l.usdValue, 0) / levels.length;
  const threshold = avg * 2.5;
  return levels
    .filter((l) => l.usdValue >= threshold)
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, topN);
}

function normalizePair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[-_/].*$/, "").replace("USDT", "");
  return s + "USDT";
}

export async function getOrderBookLiquidity(symbol: string): Promise<string> {
  try {
    const pair = normalizePair(symbol);

    const res = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=100`,
      { next: { revalidate: 10 } }
    );

    if (res.status === 400) return `❌ Pair ${pair} tidak ditemukan di Binance`;
    if (!res.ok) return `❌ Binance API error: ${res.status}`;

    const data = await res.json();
    if (!data.bids || !data.asks) return "❌ Data order book tidak valid";

    const bidLevels = parseLevels(data.bids);
    const askLevels = parseLevels(data.asks);

    if (bidLevels.length === 0 || askLevels.length === 0) {
      return "❌ Order book kosong";
    }

    const bidWalls = findWalls(bidLevels);
    const askWalls = findWalls(askLevels);

    const bestBid = bidLevels[0].price;
    const bestAsk = askLevels[0].price;
    const spread = ((bestAsk - bestBid) / bestBid * 100).toFixed(4);

    const totalBid = bidLevels.reduce((s, l) => s + l.usdValue, 0);
    const totalAsk = askLevels.reduce((s, l) => s + l.usdValue, 0);
    const buyRatio = ((totalBid / (totalBid + totalAsk)) * 100).toFixed(1);

    const sentiment = parseFloat(buyRatio) > 55 ? "🟢 Bullish"
      : parseFloat(buyRatio) < 45 ? "🔴 Bearish" : "🟡 Netral";

    let result = `💧 ORDER BOOK: ${pair}
Mid: $${((bestBid + bestAsk) / 2).toFixed(4)} | Spread: ${spread}%
Sentiment: ${sentiment} (Buy ${buyRatio}%)

🟢 BID WALLS (Support):`;

    if (bidWalls.length > 0) {
      bidWalls.forEach((w, i) => {
        result += `\n  ${i + 1}. $${w.price.toFixed(4)} — $${(w.usdValue / 1000).toFixed(1)}K`;
      });
    } else {
      result += "\n  Tidak ada bid wall signifikan";
    }

    result += `\n🔴 ASK WALLS (Resistance):`;
    if (askWalls.length > 0) {
      askWalls.forEach((w, i) => {
        result += `\n  ${i + 1}. $${w.price.toFixed(4)} — $${(w.usdValue / 1000).toFixed(1)}K`;
      });
    } else {
      result += "\n  Tidak ada ask wall signifikan";
    }

    result += `\nNearest Support: $${bestBid.toFixed(4)}`;
    result += `\nNearest Resistance: $${bestAsk.toFixed(4)}`;

    return result;
  } catch (err: any) {
    return `❌ Order book error: ${err.message}`;
  }
}

export async function getLiquidationLevels(symbol: string): Promise<string> {
  const apiKey = process.env.COINGLASS_API_KEY;
  if (!apiKey) {
    return "⚠️ Coinglass API key belum diset di .env.local\nTambahkan: COINGLASS_API_KEY=your_key\nDaftar: https://coinglass.com/pricing";
  }

  try {
    const coin = symbol.toUpperCase().replace("USDT", "").replace(/[-_/].*$/, "");
    const res = await fetch(
      `https://open-api.coinglass.com/public/v2/liquidation_map?symbol=${coin}&range=12`,
      { headers: { "coinglassSecret": apiKey } }
    );

    if (!res.ok) return `❌ Coinglass error: ${res.status}`;

    const data = await res.json();
    if (!data.data?.length) return `⚠️ Tidak ada liquidation data untuk ${coin}`;

    const sorted = data.data
      .sort((a: any, b: any) =>
        (b.longLiquidationUsd + b.shortLiquidationUsd) - (a.longLiquidationUsd + a.shortLiquidationUsd)
      )
      .slice(0, 6);

    let result = `💥 LIQUIDATION MAP: ${coin}USDT\n`;
    sorted.forEach((item: any, i: number) => {
      const total = ((item.longLiquidationUsd + item.shortLiquidationUsd) / 1e6).toFixed(2);
      const longs = (item.longLiquidationUsd / 1e6).toFixed(2);
      const shorts = (item.shortLiquidationUsd / 1e6).toFixed(2);
      const dominant = item.longLiquidationUsd > item.shortLiquidationUsd ? "🔴 LONGS" : "🟢 SHORTS";
      result += `${i + 1}. $${parseFloat(item.price).toFixed(4)} — $${total}M (${dominant})\n   L:$${longs}M S:$${shorts}M\n`;
    });
    result += `💡 Cluster besar = magnet zone harga`;

    return result;
  } catch (err: any) {
    return `❌ Liquidation error: ${err.message}`;
  }
}

export async function getFullLiquidityReport(symbol: string): Promise<string> {
  const [ob, liq] = await Promise.all([
    getOrderBookLiquidity(symbol),
    getLiquidationLevels(symbol),
  ]);
  return `${ob}\n\n${liq}`;
}
