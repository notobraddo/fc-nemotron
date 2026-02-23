// Liquidity Analysis: Order Book Depth (Binance) + Liquidation Levels (Coinglass)

// ==================== BINANCE ORDER BOOK ====================
export async function getOrderBookLiquidity(symbol: string): Promise<string> {
  try {
    // Normalize symbol: btc -> BTCUSDT
    const pair = symbol.toUpperCase().replace("USDT", "") + "USDT";

    const res = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=100`
    );

    if (!res.ok) {
      return `❌ Symbol ${pair} tidak ditemukan di Binance.`;
    }

    const data = await res.json();

    // Bids = buy orders (support)
    // Asks = sell orders (resistance)
    const bids: [string, string][] = data.bids; // [price, quantity]
    const asks: [string, string][] = data.asks;

    // Hitung total liquidity per level
    const bidLevels = aggregateLevels(bids, 10);
    const askLevels = aggregateLevels(asks, 10);

    // Find bid walls (cluster besar)
    const bidWalls = findWalls(bidLevels);
    const askWalls = findWalls(askLevels);

    // Current price estimate (mid price)
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const midPrice = ((bestBid + bestAsk) / 2).toFixed(4);

    // Total liquidity
    const totalBidLiq = bidLevels.reduce((sum, l) => sum + l.usdValue, 0);
    const totalAskLiq = askLevels.reduce((sum, l) => sum + l.usdValue, 0);
    const buyRatio = ((totalBidLiq / (totalBidLiq + totalAskLiq)) * 100).toFixed(1);
    const sellRatio = (100 - parseFloat(buyRatio)).toFixed(1);

    // Market sentiment dari order book
    const sentiment = parseFloat(buyRatio) > 55
      ? "🟢 Bullish (lebih banyak buy orders)"
      : parseFloat(buyRatio) < 45
      ? "🔴 Bearish (lebih banyak sell orders)"
      : "🟡 Netral (seimbang)";

    let result = `💧 LIQUIDITY ANALYSIS: ${pair}
💵 Mid Price: $${midPrice}
📊 Order Book Sentiment: ${sentiment}
🟢 Buy Pressure: ${buyRatio}% | 🔴 Sell Pressure: ${sellRatio}%

━━━━━━━━━━━━━━━━━━━━
🟢 BID WALLS (Support / Target Sweep Bawah)
━━━━━━━━━━━━━━━━━━━━`;

    if (bidWalls.length > 0) {
      bidWalls.forEach((wall, i) => {
        result += `\n${i + 1}. 💰 $${wall.price.toFixed(4)} — $${(wall.usdValue / 1000).toFixed(0)}K liquidity`;
      });
    } else {
      result += "\nTidak ada bid wall signifikan";
    }

    result += `\n
━━━━━━━━━━━━━━━━━━━━
🔴 ASK WALLS (Resistance / Target Sweep Atas)
━━━━━━━━━━━━━━━━━━━━`;

    if (askWalls.length > 0) {
      askWalls.forEach((wall, i) => {
        result += `\n${i + 1}. 💸 $${wall.price.toFixed(4)} — $${(wall.usdValue / 1000).toFixed(0)}K liquidity`;
      });
    } else {
      result += "\nTidak ada ask wall signifikan";
    }

    result += `\n
━━━━━━━━━━━━━━━━━━━━
🎯 LIQUIDITY ZONES (SMC Context)
━━━━━━━━━━━━━━━━━━━━
📍 Nearest Support: $${bidLevels[0]?.price.toFixed(4) || "N/A"}
📍 Nearest Resistance: $${askLevels[0]?.price.toFixed(4) || "N/A"}
📍 Strong Support: $${bidWalls[0]?.price.toFixed(4) || "N/A"} (liquidity pool)
📍 Strong Resistance: $${askWalls[0]?.price.toFixed(4) || "N/A"} (liquidity pool)`;

    return result;
  } catch (error) {
    return `❌ Gagal mengambil order book data: ${error}`;
  }
}

interface Level {
  price: number;
  quantity: number;
  usdValue: number;
}

function aggregateLevels(orders: [string, string][], groupSize: number): Level[] {
  return orders.slice(0, 50).map(([price, qty]) => {
    const p = parseFloat(price);
    const q = parseFloat(qty);
    return { price: p, quantity: q, usdValue: p * q };
  });
}

function findWalls(levels: Level[]): Level[] {
  if (levels.length === 0) return [];

  const avgValue = levels.reduce((sum, l) => sum + l.usdValue, 0) / levels.length;
  const threshold = avgValue * 2.5; // Wall = 2.5x rata-rata

  return levels
    .filter((l) => l.usdValue > threshold)
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, 5);
}

// ==================== COINGLASS LIQUIDATION ====================
export async function getLiquidationLevels(symbol: string): Promise<string> {
  const apiKey = process.env.COINGLASS_API_KEY;

  if (!apiKey) {
    return `⚠️ Coinglass API key belum diset. Tambahkan COINGLASS_API_KEY di .env.local\nDaftar gratis di: https://coinglass.com/pricing`;
  }

  try {
    const coin = symbol.toUpperCase().replace("USDT", "");

    const res = await fetch(
      `https://open-api.coinglass.com/public/v2/liquidation_map?symbol=${coin}&range=12`,
      {
        headers: {
          "coinglassSecret": apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      return `❌ Coinglass API error: ${res.status}. Cek API key kamu.`;
    }

    const data = await res.json();

    if (!data.data || data.data.length === 0) {
      return `❌ Tidak ada liquidation data untuk ${coin}`;
    }

    // Ambil liquidation clusters terbesar
    const liqData = data.data
      .sort((a: any, b: any) => (b.longLiquidationUsd + b.shortLiquidationUsd) - (a.longLiquidationUsd + a.shortLiquidationUsd))
      .slice(0, 8);

    let result = `💥 LIQUIDATION HEATMAP: ${coin}USDT\n(Data 12 jam terakhir)\n\n`;
    result += `━━━━━━━━━━━━━━━━━━━━\n`;
    result += `🎯 TOP LIQUIDATION CLUSTERS\n`;
    result += `━━━━━━━━━━━━━━━━━━━━\n`;

    liqData.forEach((item: any, i: number) => {
      const totalLiq = (item.longLiquidationUsd + item.shortLiquidationUsd) / 1e6;
      const longLiq = (item.longLiquidationUsd / 1e6).toFixed(2);
      const shortLiq = (item.shortLiquidationUsd / 1e6).toFixed(2);
      const dominant = item.longLiquidationUsd > item.shortLiquidationUsd ? "🔴 LONG" : "🟢 SHORT";

      result += `${i + 1}. $${parseFloat(item.price).toFixed(4)}
   💥 Total: $${totalLiq.toFixed(2)}M | ${dominant} dominant
   🔴 Longs: $${longLiq}M | 🟢 Shorts: $${shortLiq}M\n\n`;
    });

    result += `━━━━━━━━━━━━━━━━━━━━\n`;
    result += `💡 Area liquidation besar = target price magnet\n`;
    result += `🎯 Harga cenderung sweep ke cluster terbesar`;

    return result;
  } catch (error) {
    return `❌ Gagal mengambil liquidation data: ${error}`;
  }
}

// ==================== COMBINED LIQUIDITY REPORT ====================
export async function getFullLiquidityReport(symbol: string): Promise<string> {
  const [orderBook, liquidation] = await Promise.all([
    getOrderBookLiquidity(symbol),
    getLiquidationLevels(symbol),
  ]);

  return `${orderBook}\n\n${liquidation}`;
}
