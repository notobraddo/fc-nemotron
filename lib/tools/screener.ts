export interface TokenScreenerParams {
  minVolume?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minPriceChange?: number;
  maxPriceChange?: number;
  limit?: number;
  page?: number;
}

// Ambil semua token dari CoinGecko (up to 250 token per request)
export async function screenTokens(params: TokenScreenerParams): Promise<string> {
  try {
    const page = params.page || 1;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
    );
    const data = await res.json();

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
    });

    const limit = params.limit || 7;
    filtered = filtered.slice(0, limit);

    if (filtered.length === 0) {
      return "❌ Tidak ada token yang memenuhi kriteria.";
    }

    const result = filtered.map((coin: any, i: number) => {
      const change = coin.price_change_percentage_24h?.toFixed(2) || "N/A";
      const vol = (coin.total_volume / 1e6).toFixed(1);
      const mcap = (coin.market_cap / 1e6).toFixed(1);
      const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
      return `${i + 1}. ${coin.name} (${coin.symbol.toUpperCase()})
   💵 $${coin.current_price.toLocaleString()} ${emoji} ${change}%
   💧 Vol: $${vol}M | MCap: $${mcap}M`;
    }).join("\n\n");

    return `🔍 Screening Results (${filtered.length} tokens):\n\n${result}`;
  } catch {
    return "Gagal melakukan screening.";
  }
}

// Ambil OHLCV — coba CoinGecko dulu, fallback ke search
export async function getTokenOHLCV(coinId: string): Promise<any> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=14`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export async function getTokenMarketData(coinId: string): Promise<any> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
