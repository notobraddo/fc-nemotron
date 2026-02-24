const BASE = "https://api.coingecko.com/api/v3";

async function safeFetch(url: string): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      return safeFetch(url);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function searchCoinId(query: string): Promise<string | null> {
  try {
    const data = await safeFetch(`${BASE}/search?query=${encodeURIComponent(query)}`);
    if (!data?.coins?.length) return null;
    // Prioritaskan exact match symbol
    const exact = data.coins.find((c: any) =>
      c.symbol.toLowerCase() === query.toLowerCase()
    );
    return exact?.id || data.coins[0]?.id || null;
  } catch { return null; }
}

export async function getCryptoPrice(coinId: string): Promise<string> {
  try {
    const data = await safeFetch(
      `${BASE}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
    );
    const coin = data?.[coinId];
    if (!coin) return `❌ Data tidak ditemukan untuk ${coinId}`;
    const change = coin.usd_24h_change?.toFixed(2) || "N/A";
    const vol = coin.usd_24h_vol ? `$${(coin.usd_24h_vol / 1e6).toFixed(1)}M` : "N/A";
    const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
    return `${coinId.toUpperCase()}: $${coin.usd?.toLocaleString()} ${emoji}${change}% Vol:${vol}`;
  } catch { return "❌ Gagal mengambil harga"; }
}

export async function getTrendingCoins(): Promise<string> {
  try {
    const data = await safeFetch(`${BASE}/search/trending`);
    if (!data?.coins) return "❌ Gagal mengambil trending";
    const list = data.coins.slice(0, 7).map((c: any, i: number) => {
      const change = c.item.data?.price_change_percentage_24h?.usd?.toFixed(2) || "N/A";
      const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
      return `${i + 1}. ${c.item.symbol.toUpperCase()} ${emoji}${change}%`;
    }).join("\n");
    return `🔥 Trending:\n${list}`;
  } catch { return "❌ Gagal mengambil trending"; }
}

export async function getTopCoins(): Promise<string> {
  try {
    const data = await safeFetch(
      `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false`
    );
    if (!Array.isArray(data)) return "❌ Gagal mengambil market data";
    const list = data.map((c: any, i: number) => {
      const change = c.price_change_percentage_24h?.toFixed(2) || "N/A";
      const emoji = parseFloat(change) > 0 ? "🟢" : "🔴";
      return `${i + 1}. ${c.symbol.toUpperCase()} $${c.current_price?.toLocaleString()} ${emoji}${change}%`;
    }).join("\n");
    return `📊 Top 10:\n${list}`;
  } catch { return "❌ Gagal mengambil market data"; }
}
