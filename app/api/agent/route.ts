import { NextRequest, NextResponse } from "next/server";
import { callNvidiaAgent, Message } from "@/lib/nvidia-nim";
import { getCryptoPrice, getTrendingCoins, getTopCoins, searchCoinId } from "@/lib/tools/coingecko";
import { webSearch } from "@/lib/tools/websearch";
import { screenTokens, getTokenOHLCV, getTokenMarketData } from "@/lib/tools/screener";
import { generateTechnicalReport } from "@/lib/tools/technical";
import { getOrderBookLiquidity, getLiquidationLevels, getFullLiquidityReport } from "@/lib/tools/liquidity";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const conversationStore = new Map<string, Message[]>();

const SYSTEM_PROMPT = `You are FC_Agent, a professional crypto trading AI.
You specialize in Technical Analysis: SMC, Moving Average (MA7, MA25, EMA9, EMA21), RSI, and Token Screening.

When given technical data ALWAYS provide:
1. 📍 Market Bias (Bullish/Bearish/Sideways)
2. 🔑 Key Levels (Support & Resistance)
3. 🎯 Entry Zone (price range)
4. 🛑 Stop Loss (SL)
5. 💰 Take Profit (TP1, TP2, TP3)
6. ⚖️ Risk/Reward Ratio
7. 💯 Confidence (1-10)
8. 📝 Brief Reasoning

Format clearly with emojis. Always end with: ⚠️ DYOR — Not financial advice.
Respond in the same language as the user.`;

// Hardcoded map untuk coin populer (fast lookup)
const COIN_MAP: Record<string, string> = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum",
  bnb: "binancecoin",
  sol: "solana", solana: "solana",
  xrp: "ripple", ripple: "ripple",
  ada: "cardano", cardano: "cardano",
  doge: "dogecoin", dogecoin: "dogecoin",
  dot: "polkadot", polkadot: "polkadot",
  matic: "matic-network", polygon: "matic-network",
  avax: "avalanche-2", avalanche: "avalanche-2",
  link: "chainlink", chainlink: "chainlink",
  uni: "uniswap", uniswap: "uniswap",
  atom: "cosmos", cosmos: "cosmos",
  near: "near",
  sui: "sui",
  arb: "arbitrum", arbitrum: "arbitrum",
  op: "optimism", optimism: "optimism",
  apt: "aptos", aptos: "aptos",
  inj: "injective-protocol", injective: "injective-protocol",
  tia: "celestia", celestia: "celestia",
  sei: "sei-network",
  jup: "jupiter-exchange-solana",
  wld: "worldcoin-wld",
  pepe: "pepe",
  shib: "shiba-inu",
  floki: "floki",
  ftm: "fantom", fantom: "fantom",
  crv: "curve-dao-token",
  aave: "aave",
  mkr: "maker",
  snx: "havven",
  // Layer 2
  zro: "layerzero",
  zk: "zksync",
  strk: "starknet",
  manta: "manta-network",
  blast: "blast",
  // Meme
  bonk: "bonk",
  wif: "dogwifcoin",
  popcat: "popcat",
  brett: "brett",
  // DeFi
  pendle: "pendle",
  gmx: "gmx",
  dydx: "dydx",
  cake: "pancakeswap-token",
  // AI tokens
  fet: "fetch-ai",
  rndr: "render-token", render: "render-token",
  wmt: "world-mobile-token",
  ocean: "ocean-protocol",
  // Others
  sand: "the-sandbox",
  mana: "decentraland",
  axs: "axie-infinity",
  imx: "immutable-x",
  gala: "gala",
  ape: "apecoin",
  ldo: "lido-dao",
  steth: "staked-ether",
  rpl: "rocket-pool",
};

// Extract token symbol dari teks (hapus "usdt", "usd", "busd" suffix)
function extractSymbol(msg: string): string | null {
  // Match pattern seperti "btcusdt", "ethusdt", "zrousdt"
  const pairMatch = msg.match(/\b([a-z]{2,10})(usdt|usd|busd|usdc|bnb|eth|btc)\b/i);
  if (pairMatch) return pairMatch[1].toLowerCase();

  // Match standalone symbol
  const symbolMatch = msg.match(/\b([a-z]{2,10})\b/gi);
  if (symbolMatch) {
    for (const s of symbolMatch) {
      const lower = s.toLowerCase();
      if (COIN_MAP[lower]) return lower;
      if (lower.length >= 2 && lower.length <= 6) return lower;
    }
  }
  return null;
}

async function resolveCoinId(symbol: string): Promise<string | null> {
  // Cek hardcoded map dulu (cepat)
  if (COIN_MAP[symbol]) return COIN_MAP[symbol];

  // Fallback ke CoinGecko search API (dynamic)
  console.log(`Searching CoinGecko for: ${symbol}`);
  const coinId = await searchCoinId(symbol);
  return coinId;
}

const TA_KEYWORDS = [
  "analisis", "analysis", "analyze", "analisa", "teknikal", "technical",
  "smc", "smart money", "order block", "ob", "fvg", "fair value gap",
  "bos", "choch", "liquidity", "sweep", "imbalance",
  "rsi", "moving average", "ma", "ema", "sma", "macd", "bollinger",
  "entry", "long", "short", "buy", "sell", "beli", "jual",
  "posisi", "position", "open", "close", "scalp", "swing", "spot",
  "support", "resistance", "sr", "level", "zona", "zone", "area",
  "carikan", "cari", "kasih", "berikan", "tunjukkan", "setup",
  "peluang", "sinyal", "signal", "stoploss", "stop loss", "sl",
  "take profit", "tp", "target", "r/r", "risk", "reward", "cutloss",
  "breakout", "breakdown", "retest", "bounce", "reversal",
  "bullish", "bearish", "sideways", "trend", "tren",
  "prediksi", "predict", "forecast", "pump", "dump", "dip",
  "candle", "candlestick", "pattern", "pola", "timeframe", "tf",
  "1m", "5m", "15m", "1h", "4h", "1d", "weekly", "daily",
];

const SCREEN_KEYWORDS = [
  "screen", "screening", "filter", "scan", "scanner",
  "cari token", "find token", "find coin", "token bagus", "coin bagus",
  "volume tinggi", "high volume", "gainers", "gainer",
  "losers", "loser", "momentum", "movers",
  "large cap", "mid cap", "small cap", "micro cap",
  "rekomendasi", "recommend", "watchlist",
  "top performer", "best coin", "altcoin bagus",
  "naik", "turun", "pump candidate",
];

function needsTA(msg: string): boolean {
  return TA_KEYWORDS.some((k) => msg.toLowerCase().includes(k));
}

function needsScreening(msg: string): boolean {
  return SCREEN_KEYWORDS.some((k) => msg.toLowerCase().includes(k));
}

async function runTools(
  message: string,
  history: Message[]
): Promise<{ toolResult: string; tool: string | null }> {
  const msg = message.toLowerCase();

  // Extract symbol dari pesan
  let symbol = extractSymbol(msg);
  let coinId: string | null = null;

  if (symbol) {
    coinId = await resolveCoinId(symbol);
  }

  // Kalau tidak ketemu, cari dari history
  if (!coinId && needsTA(msg)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const histSymbol = extractSymbol(history[i].content.toLowerCase());
      if (histSymbol) {
        coinId = await resolveCoinId(histSymbol);
        if (coinId) break;
      }
    }
  }


  // Liquidity Heatmap
  const needsLiquidity = LIQUIDITY_KEYWORDS.some((k) => msg.includes(k));
  if (needsLiquidity && coinId) {
    const hasLiquidation = msg.includes("liquidation") || msg.includes("likuidasi") ||
                           msg.includes("heatmap") || msg.includes("liq");
    if (hasLiquidation) {
      const report = await getFullLiquidityReport(coinId.replace("-", ""));
      return { toolResult: report, tool: "liquidity" };
    } else {
      const report = await getOrderBookLiquidity(coinId.replace("-", ""));
      return { toolResult: report, tool: "liquidity" };
    }
  }

  // Technical Analysis
  if (needsTA(msg) && coinId) {
    const [ohlcv, marketData] = await Promise.all([
      getTokenOHLCV(coinId),
      getTokenMarketData(coinId),
    ]);
    if (ohlcv && marketData) {
      const price = marketData.market_data?.current_price?.usd || 0;
      const name = marketData.name || coinId;
      const report = generateTechnicalReport(name, ohlcv, price);
      return { toolResult: report, tool: "technical" };
    } else {
      // OHLCV tidak ada, minimal kasih price data
      const priceData = await getCryptoPrice(coinId);
      return { toolResult: `Data terbatas untuk ${coinId}:\n${priceData}`, tool: "price" };
    }
  }

  // Token Screening
  if (needsScreening(msg)) {
    let params: any = { limit: 7 };
    if (msg.includes("pump") || msg.includes("naik") || msg.includes("gainer")) params.minPriceChange = 3;
    if (msg.includes("dump") || msg.includes("turun") || msg.includes("loser")) params.maxPriceChange = -3;
    if (msg.includes("volume")) params.minVolume = 50_000_000;
    if (msg.includes("large")) params.minMarketCap = 1_000_000_000;
    if (msg.includes("mid")) { params.minMarketCap = 100_000_000; params.maxMarketCap = 1_000_000_000; }
    if (msg.includes("small") || msg.includes("micro")) { params.minMarketCap = 1_000_000; params.maxMarketCap = 100_000_000; }
    const result = await screenTokens(params);
    return { toolResult: result, tool: "screener" };
  }

  // Harga
  if ((msg.includes("harga") || msg.includes("price") || msg.includes("berapa")) && coinId) {
    return { toolResult: await getCryptoPrice(coinId), tool: "price" };
  }

  // Trending
  if (msg.includes("trending") || msg.includes("tren") || msg.includes("populer")) {
    return { toolResult: await getTrendingCoins(), tool: "trending" };
  }

  // Top market
  if (msg.includes("top") || msg.includes("market") || msg.includes("ranking")) {
    return { toolResult: await getTopCoins(), tool: "market" };
  }

  // Web search
  if (msg.includes("berita") || msg.includes("news") || msg.includes("terbaru") || msg.includes("update")) {
    return { toolResult: await webSearch(message), tool: "search" };
  }

  return { toolResult: "", tool: null };
}

export async function POST(req: NextRequest) {
  try {
    const { userMessage, userId } = await req.json();
    if (!userMessage || !userId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const history = conversationStore.get(userId) || [];
    const { toolResult, tool } = await runTools(userMessage, history);

    const enriched = toolResult
      ? `${userMessage}\n\n[Live market data]:\n${toolResult}`
      : userMessage;

    history.push({ role: "user", content: enriched });

    const agentResponse = await callNvidiaAgent(history, SYSTEM_PROMPT);

    history[history.length - 1] = { role: "user", content: userMessage };
    history.push({ role: "assistant", content: agentResponse.content });

    if (history.length > 30) history.splice(0, history.length - 30);
    conversationStore.set(userId, history);

    return NextResponse.json({ response: agentResponse.content, toolUsed: tool });
  } catch (error: any) {
    console.error("Agent error:", error);
    return NextResponse.json({ error: error.message || "Agent failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json();
  conversationStore.delete(userId);
  return NextResponse.json({ success: true });
}

// Patch: tambah ke runTools sebelum return { toolResult: "", tool: null }
