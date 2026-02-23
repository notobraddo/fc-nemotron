import { NextRequest, NextResponse } from "next/server";
import { callNvidiaAgent, Message } from "@/lib/nvidia-nim";
import { getCryptoPrice, getTrendingCoins, getTopCoins, searchCoinId } from "@/lib/tools/coingecko";
import { webSearch } from "@/lib/tools/websearch";
import { screenTokens, getTokenOHLCV, getTokenMarketData } from "@/lib/tools/screener";
import { generateTechnicalReport } from "@/lib/tools/technical";
import { getOrderBookLiquidity, getLiquidationLevels } from "@/lib/tools/liquidity";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const conversationStore = new Map<string, Message[]>();

const SYSTEM_PROMPT = `You are FC_Agent, a professional crypto trading AI.
Analyze all provided market data and respond ONLY in this exact format:

🎯 ENTRY: $[price or range]
🛑 STOP LOSS: $[price]
💰 TP1: $[price]
💰 TP2: $[price]
💰 TP3: $[price]
📝 ALASAN: [1-2 kalimat singkat]
💯 CONFIDENCE: [X/10]
⚠️ DYOR — Not financial advice

Rules:
- No intro, no outro, no extra text
- Respond in same language as user
- Base analysis on real data provided`;

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
  near: "near", sui: "sui",
  arb: "arbitrum", arbitrum: "arbitrum",
  op: "optimism", optimism: "optimism",
  apt: "aptos", aptos: "aptos",
  inj: "injective-protocol", injective: "injective-protocol",
  tia: "celestia", celestia: "celestia",
  sei: "sei-network",
  jup: "jupiter-exchange-solana",
  wld: "worldcoin-wld",
  pepe: "pepe", shib: "shiba-inu", floki: "floki",
  ftm: "fantom", fantom: "fantom",
  crv: "curve-dao-token", aave: "aave", mkr: "maker",
  zro: "layerzero", zk: "zksync",
  strk: "starknet", manta: "manta-network",
  bonk: "bonk", wif: "dogwifcoin",
  pendle: "pendle", gmx: "gmx",
  cake: "pancakeswap-token",
  fet: "fetch-ai", rndr: "render-token",
  sand: "the-sandbox", mana: "decentraland",
  axs: "axie-infinity", imx: "immutable-x",
  ldo: "lido-dao", rpl: "rocket-pool",
};

const TA_KEYWORDS = [
  "analisis", "analysis", "analyze", "analisa", "teknikal", "technical",
  "smc", "smart money", "order block", "fvg", "fair value gap",
  "bos", "choch", "imbalance",
  "rsi", "moving average", "ma", "ema", "sma", "macd",
  "entry", "long", "short", "buy", "sell", "beli", "jual",
  "posisi", "position", "scalp", "swing", "spot",
  "support", "resistance", "zona", "zone", "area",
  "carikan", "cari", "kasih", "berikan", "tunjukkan", "setup",
  "sinyal", "signal", "stoploss", "stop loss", "sl",
  "take profit", "tp", "target", "risk", "reward",
  "breakout", "breakdown", "retest", "bounce", "reversal",
  "bullish", "bearish", "sideways", "trend", "tren",
  "prediksi", "predict", "forecast", "dip", "pump", "dump",
  "1m", "5m", "15m", "1h", "4h", "1d", "weekly", "daily",
  "trading", "trade", "trader",
];

const SCREEN_KEYWORDS = [
  "screen", "screening", "filter", "scan",
  "cari token", "find token", "token bagus", "coin bagus",
  "volume tinggi", "high volume", "gainers", "gainer",
  "losers", "loser", "momentum", "movers",
  "large cap", "mid cap", "small cap", "micro cap",
  "rekomendasi", "recommend", "watchlist",
];

const LIQUIDITY_ONLY_KEYWORDS = [
  "order book", "orderbook", "bid wall", "ask wall",
  "whale wall", "depth", "heatmap",
  "liquidation", "likuidasi", "liq map",
];

function extractSymbol(msg: string): string | null {
  const pairMatch = msg.match(/\b([a-z]{2,10})(usdt|usd|busd|usdc|bnb|eth|btc)\b/i);
  if (pairMatch) return pairMatch[1].toLowerCase();
  for (const key of Object.keys(COIN_MAP)) {
    const regex = new RegExp(`\\b${key}\\b`, "i");
    if (regex.test(msg)) return key;
  }
  return null;
}

async function resolveCoinId(symbol: string): Promise<string | null> {
  if (COIN_MAP[symbol]) return COIN_MAP[symbol];
  return await searchCoinId(symbol);
}

function needsTA(msg: string): boolean {
  return TA_KEYWORDS.some((k) => msg.toLowerCase().includes(k));
}

function needsScreening(msg: string): boolean {
  return SCREEN_KEYWORDS.some((k) => msg.toLowerCase().includes(k));
}

function needsLiquidityOnly(msg: string): boolean {
  return LIQUIDITY_ONLY_KEYWORDS.some((k) => msg.toLowerCase().includes(k));
}

async function runFullTradingPipeline(coinId: string, symbol: string): Promise<string> {
  const rawSymbol = symbol.toUpperCase();

  const [ohlcv, marketData, orderBook, liquidation] = await Promise.allSettled([
    getTokenOHLCV(coinId),
    getTokenMarketData(coinId),
    getOrderBookLiquidity(rawSymbol),
    getLiquidationLevels(rawSymbol),
  ]);

  let fullReport = "";

  fullReport += "=== PRICE & CHART (CoinGecko) ===\n";
  const ohlcvData = ohlcv.status === "fulfilled" ? ohlcv.value : null;
  const mktData = marketData.status === "fulfilled" ? marketData.value : null;

  if (ohlcvData && mktData) {
    const price = mktData.market_data?.current_price?.usd || 0;
    const change24h = mktData.market_data?.price_change_percentage_24h?.toFixed(2) || "N/A";
    const change7d = mktData.market_data?.price_change_percentage_7d?.toFixed(2) || "N/A";
    const vol = mktData.market_data?.total_volume?.usd
      ? `$${(mktData.market_data.total_volume.usd / 1e6).toFixed(1)}M`
      : "N/A";
    const mcap = mktData.market_data?.market_cap?.usd
      ? `$${(mktData.market_data.market_cap.usd / 1e9).toFixed(2)}B`
      : "N/A";

    fullReport += `Price: $${price.toLocaleString()}\n`;
    fullReport += `24h: ${change24h}% | 7d: ${change7d}%\n`;
    fullReport += `Volume: ${vol} | MCap: ${mcap}\n\n`;

    const taReport = generateTechnicalReport(mktData.name || coinId, ohlcvData, price);
    fullReport += taReport;
  } else {
    fullReport += "Chart data tidak tersedia\n";
  }

  fullReport += "\n\n=== ORDER BOOK (Binance) ===\n";
  if (orderBook.status === "fulfilled") {
    fullReport += orderBook.value;
  } else {
    fullReport += "Order book tidak tersedia\n";
  }

  fullReport += "\n\n=== LIQUIDATION LEVELS (Coinglass) ===\n";
  if (liquidation.status === "fulfilled") {
    fullReport += liquidation.value;
  } else {
    fullReport += "Liquidation data tidak tersedia\n";
  }

  return fullReport;
}

async function runTools(
  message: string,
  history: Message[]
): Promise<{ toolResult: string; tool: string | null }> {
  const msg = message.toLowerCase();

  let symbol = extractSymbol(msg);
  let coinId: string | null = null;

  if (symbol) {
    coinId = await resolveCoinId(symbol);
  }

  if (!coinId && (needsTA(msg) || needsLiquidityOnly(msg))) {
    for (let i = history.length - 1; i >= 0; i--) {
      const histSymbol = extractSymbol(history[i].content.toLowerCase());
      if (histSymbol) {
        coinId = await resolveCoinId(histSymbol);
        symbol = histSymbol;
        if (coinId) break;
      }
    }
  }

  if (needsTA(msg) && coinId && symbol) {
    const data = await runFullTradingPipeline(coinId, symbol);
    return { toolResult: data, tool: "pipeline" };
  }

  if (needsLiquidityOnly(msg) && coinId && symbol) {
    const rawSymbol = symbol.toUpperCase();
    const [ob, liq] = await Promise.all([
      getOrderBookLiquidity(rawSymbol),
      getLiquidationLevels(rawSymbol),
    ]);
    return { toolResult: `${ob}\n\n${liq}`, tool: "liquidity" };
  }

  if (needsScreening(msg)) {
    let params: any = { limit: 7 };
    if (msg.includes("pump") || msg.includes("naik") || msg.includes("gainer")) params.minPriceChange = 3;
    if (msg.includes("dump") || msg.includes("turun") || msg.includes("loser")) params.maxPriceChange = -3;
    if (msg.includes("volume")) params.minVolume = 50_000_000;
    if (msg.includes("large")) params.minMarketCap = 1_000_000_000;
    if (msg.includes("mid")) { params.minMarketCap = 100_000_000; params.maxMarketCap = 1_000_000_000; }
    if (msg.includes("small") || msg.includes("micro")) { params.minMarketCap = 1_000_000; params.maxMarketCap = 100_000_000; }
    return { toolResult: await screenTokens(params), tool: "screener" };
  }

  if ((msg.includes("harga") || msg.includes("price") || msg.includes("berapa")) && coinId) {
    return { toolResult: await getCryptoPrice(coinId), tool: "price" };
  }

  if (msg.includes("trending") || msg.includes("tren") || msg.includes("populer")) {
    return { toolResult: await getTrendingCoins(), tool: "trending" };
  }

  if (msg.includes("top") || msg.includes("market") || msg.includes("ranking")) {
    return { toolResult: await getTopCoins(), tool: "market" };
  }

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
      ? `${userMessage}\n\n[Live market data — CoinGecko + Binance + Coinglass]:\n${toolResult}`
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
