const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
        next: { revalidate: 30 },
      });

      if (res.status === 429) {
        // Rate limited — tunggu 2 detik
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export interface TokenScreenerParams {
  minVolume?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minPriceChange?: number;
  maxPriceChange?: number;
  limit?: number;
}

export async function screenTokens(params: TokenScreenerParams): Promise<string> {
  try {
    const data = await fetchWithRetry(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`
    );

    if (!Array.isArray(data)) return "❌ Screening gagal — data tidak valid";

    let filtered = data.filter((coin: any) => {
      const volume = coin.total_volume || 0;
      const marketCap = coin.market_cap || 0;
      const priceChange = coin.price_change_percentage_24h || 0;
      if (params.minVolume && volume < params.minVolume) return false;
      if (params.minMarketCap && marketCap < params.minMarketCap) return false;
      if (params.maxMarketCap && marketCap > params.maxMarketCap) return false;
      if (params.minPriceChange !== undefined && priceChange < params.minPriceChange) return false;
      if (params.maxPriceChange !== undefined && priceChange > params.maxPriceChange) return false;
      return true;
    }).slice(0, params.limit || 7);

    if (filtered.length === 0) return "❌ Tidak ada token yang memenuhi kriteria";

    const result = filtered.map((c: any, i: number) => {
      const change = c.price_change_percentage_24h?.toFixed(2) || "N/A";
      const vol = ((c.total_volume || 0) / 1e6).toFixed(1);
      const mcap = ((c.market_cap || 0) / 1e6).toFixed(1);
      const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
      return `${i + 1}. ${c.symbol.toUpperCase()} $${c.current_price?.toLocaleString() || 0} ${emoji}${change}% Vol:$${vol}M`;
    }).join("\n");

    return `🔍 Screener:\n${result}`;
  } catch (err: any) {
    return `❌ Screener error: ${err.message}`;
  }
}

export async function getTokenOHLCV(coinId: string): Promise<number[][] | null> {
  try {
    const data = await fetchWithRetry(
      `${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=14`
    );
    if (!Array.isArray(data) || data.length < 10) return null;
    // Validasi format: [timestamp, open, high, low, close]
    const valid = data.filter((c) => Array.isArray(c) && c.length === 5 && !c.some(isNaN));
    return valid.length >= 10 ? valid : null;
  } catch {
    return null;
  }
}

export async function getTokenMarketData(coinId: string): Promise<any> {
  try {
    return await fetchWithRetry(
      `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
  } catch {
    return null;
  }
}
