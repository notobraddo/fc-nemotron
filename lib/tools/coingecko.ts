// Cari coin ID secara dinamis dari CoinGecko
export async function searchCoinId(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    if (data.coins && data.coins.length > 0) {
      return data.coins[0].id; // Ambil hasil paling relevan
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCryptoPrice(coinId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
    );
    const data = await res.json();
    const coin = data[coinId];
    if (!coin) return `Data tidak ditemukan untuk ${coinId}`;
    const change = coin.usd_24h_change?.toFixed(2) || "N/A";
    const vol = coin.usd_24h_vol ? `$${(coin.usd_24h_vol / 1e6).toFixed(1)}M` : "N/A";
    const mcap = coin.usd_market_cap ? `$${(coin.usd_market_cap / 1e6).toFixed(1)}M` : "N/A";
    const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
    return `${coinId.toUpperCase()}: $${coin.usd.toLocaleString()} ${emoji} ${change}% | Vol: ${vol} | MCap: ${mcap}`;
  } catch {
    return "Gagal mengambil data harga.";
  }
}

export async function getTrendingCoins(): Promise<string> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending");
    const data = await res.json();
    const trending = data.coins
      .slice(0, 7)
      .map((c: any, i: number) => {
        const change = c.item.data?.price_change_percentage_24h?.usd?.toFixed(2) || "N/A";
        const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
        return `${i + 1}. ${c.item.name} (${c.item.symbol}) ${emoji} ${change}%`;
      })
      .join("\n");
    return `🔥 Trending:\n${trending}`;
  } catch {
    return "Gagal mengambil trending.";
  }
}

export async function getTopCoins(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false"
    );
    const data = await res.json();
    const top = data
      .map((c: any, i: number) => {
        const change = c.price_change_percentage_24h?.toFixed(2) || "N/A";
        const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
        return `${i + 1}. ${c.symbol.toUpperCase()}: $${c.current_price.toLocaleString()} ${emoji} ${change}%`;
      })
      .join("\n");
    return `📊 Top 10 by MCap:\n${top}`;
  } catch {
    return "Gagal mengambil market data.";
  }
}
