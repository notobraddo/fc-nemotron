const { isMainThread, parentPort, workerData } = require("worker_threads");

// Import tools via require (compiled JS)
// Karena kita di worker, kita pakai fetch langsung

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "deepseek-ai/deepseek-r1-distill-qwen-14b";

const WATCHLIST = [
  { symbol: "btc", coinId: "bitcoin" },
  { symbol: "eth", coinId: "ethereum" },
  { symbol: "sol", coinId: "solana" },
  { symbol: "bnb", coinId: "binancecoin" },
  { symbol: "xrp", coinId: "ripple" },
];

// In-worker portfolio state (independent dari main thread)
const portfolios = new Map();

function getPortfolio(userId) {
  if (!portfolios.has(userId)) {
    portfolios.set(userId, {
      balance: 1000,
      initialBalance: 1000,
      positions: [],
      closedTrades: [],
      totalTrades: 0,
      wins: 0,
      losses: 0,
      pnlHistory: [{ time: new Date(), value: 1000 }],
    });
  }
  return portfolios.get(userId);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    return fetchJSON(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function getPrice(coinId) {
  try {
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
    );
    return data[coinId]?.usd || null;
  } catch { return null; }
}

async function getOHLCV(coinId) {
  try {
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=7`
    );
    if (!Array.isArray(data) || data.length < 10) return null;
    return data.filter(c => Array.isArray(c) && c.length === 5);
  } catch { return null; }
}

async function getOrderBook(symbol) {
  try {
    const pair = symbol.toUpperCase() + "USDT";
    const data = await fetchJSON(
      `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=20`
    );
    const topBid = data.bids?.[0]?.[0] || "N/A";
    const topAsk = data.asks?.[0]?.[0] || "N/A";
    return `Best Bid: $${topBid} | Best Ask: $${topAsk}`;
  } catch { return "Order book unavailable"; }
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(diff, 0)) / period;
    al = (al * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (al === 0) return 100;
  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

function calcMA(closes, period) {
  if (!closes || closes.length < period) return closes?.[closes.length - 1] || 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

async function callAI(prompt) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY not set");

  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are FC_Agent AutoTrader. Respond ONLY in JSON:
{"action":"OPEN"|"SKIP","type":"LONG"|"SHORT","entry":0.0,"tp1":0.0,"tp2":0.0,"tp3":0.0,"sl":0.0,"confidence":0,"reason":"string"}
Rules: OPEN only if confidence>=6, RR>=2:1, SL max 3% from entry.`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.6,
      top_p: 0.7,
      max_tokens: 256,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`AI API error: ${res.status}`);
  const data = await res.json();
  let content = data.choices[0].message.content || "";
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Juga handle unclosed think tags
  content = content.replace(/<think>[\s\S]*/g, "").trim();
  return content;
}

function updatePositions(portfolio, priceMap) {
  const closed = [];
  const remaining = [];

  for (const pos of portfolio.positions) {
    const price = priceMap[pos.coinId] || pos.currentPrice;
    pos.currentPrice = price;

    pos.pnl = pos.type === "LONG"
      ? (price - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - price) * pos.quantity;
    pos.pnlPercent = (pos.pnl / pos.size) * 100;

    let closeReason = null;
    if (pos.type === "LONG") {
      if (price <= pos.sl) closeReason = "SL";
      else if (price >= pos.tp3) closeReason = "TP3";
      else if (price >= pos.tp2) closeReason = "TP2";
      else if (price >= pos.tp1) closeReason = "TP1";
    } else {
      if (price >= pos.sl) closeReason = "SL";
      else if (price <= pos.tp3) closeReason = "TP3";
      else if (price <= pos.tp2) closeReason = "TP2";
      else if (price <= pos.tp1) closeReason = "TP1";
    }

    if (closeReason) {
      pos.closeReason = closeReason;
      pos.closeTime = new Date();
      portfolio.balance += pos.size + pos.pnl;
      portfolio.totalTrades++;
      if (pos.pnl > 0) portfolio.wins++; else portfolio.losses++;
      portfolio.closedTrades.unshift(pos);
      closed.push(pos);
    } else {
      remaining.push(pos);
    }
  }

  portfolio.positions = remaining;
  return closed;
}

async function runCycle(userId) {
  const logs = [];
  const ts = new Date().toLocaleTimeString();
  const portfolio = getPortfolio(userId);

  logs.push(`[${ts}] 🔄 Cycle start — Balance: $${portfolio.balance.toFixed(2)} | Positions: ${portfolio.positions.length}`);

  // Update open positions
  if (portfolio.positions.length > 0) {
    const priceMap = {};
    await Promise.all(portfolio.positions.map(async (pos) => {
      const price = await getPrice(pos.coinId);
      if (price) priceMap[pos.coinId] = price;
    }));

    const closed = updatePositions(portfolio, priceMap);
    closed.forEach(pos => {
      const emoji = pos.closeReason === "SL" ? "🔴" : "🟢";
      logs.push(`[${ts}] ${emoji} CLOSED ${pos.type} ${pos.coin} ${pos.closeReason} PnL:$${pos.pnl.toFixed(2)}`);
    });
  }

  // Scan untuk posisi baru
  if (portfolio.positions.length < 3) {
    for (const coin of WATCHLIST) {
      if (portfolio.positions.find(p => p.coinId === coin.coinId)) {
        logs.push(`[${ts}] ⏭️ SKIP ${coin.symbol.toUpperCase()} — position exists`);
        continue;
      }

      try {
        const [price, ohlcv, ob] = await Promise.all([
          getPrice(coin.coinId),
          getOHLCV(coin.coinId),
          getOrderBook(coin.symbol),
        ]);

        if (!price) {
          logs.push(`[${ts}] ⚠️ ${coin.symbol.toUpperCase()} — no price data`);
          continue;
        }

        let taInfo = `Price: $${price}`;
        if (ohlcv && ohlcv.length >= 15) {
          const closes = ohlcv.map(c => c[4]);
          const rsi = calcRSI(closes);
          const ma7 = calcMA(closes, 7).toFixed(4);
          const ma25 = calcMA(closes, Math.min(25, closes.length)).toFixed(4);
          const highs = ohlcv.map(c => c[2]);
          const lows = ohlcv.map(c => c[3]);
          const recentHigh = Math.max(...highs.slice(-5)).toFixed(4);
          const recentLow = Math.min(...lows.slice(-5)).toFixed(4);
          taInfo = `Price:$${price} RSI:${rsi} MA7:$${ma7} MA25:$${ma25} High:$${recentHigh} Low:$${recentLow} ${ob}`;
        }

        const aiRaw = await callAI(`Analyze ${coin.symbol.toUpperCase()}USDT: ${taInfo}`);

        let decision;
        try {
          const match = aiRaw.match(/\{[\s\S]*?\}/);
          if (match) decision = JSON.parse(match[0]);
        } catch {
          logs.push(`[${ts}] ⚠️ ${coin.symbol.toUpperCase()} — JSON parse error`);
          continue;
        }

        if (decision?.action === "OPEN" && decision.confidence >= 6 && price) {
          // Validasi TP/SL
          const valid = decision.type === "LONG"
            ? (decision.sl < price && decision.tp1 > price)
            : (decision.sl > price && decision.tp1 < price);

          if (!valid) {
            logs.push(`[${ts}] ⚠️ ${coin.symbol.toUpperCase()} — Invalid TP/SL levels`);
            continue;
          }

          const size = portfolio.balance * 0.1;
          if (size < 5) {
            logs.push(`[${ts}] ⚠️ Balance tidak cukup`);
            continue;
          }

          const pos = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            coin: coin.symbol.toUpperCase(),
            coinId: coin.coinId,
            type: decision.type,
            entryPrice: price,
            currentPrice: price,
            size,
            quantity: size / price,
            tp1: decision.tp1,
            tp2: decision.tp2,
            tp3: decision.tp3,
            sl: decision.sl,
            pnl: 0,
            pnlPercent: 0,
            status: "OPEN",
            openTime: new Date(),
          };

          portfolio.balance -= size;
          portfolio.positions.push(pos);
          logs.push(`[${ts}] ✅ OPEN ${decision.type} ${coin.symbol.toUpperCase()} @$${price} C:${decision.confidence}/10 | ${decision.reason}`);
        } else {
          logs.push(`[${ts}] ⏭️ SKIP ${coin.symbol.toUpperCase()} C:${decision?.confidence || 0}/10 | ${decision?.reason || "low confidence"}`);
        }

        // Delay antar coin untuk hindari rate limit
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        logs.push(`[${ts}] ❌ ERROR ${coin.symbol.toUpperCase()} — ${err.message}`);
      }
    }
  } else {
    logs.push(`[${ts}] ⏸️ Max positions (3/3)`);
  }

  // Update PnL history
  const openVal = portfolio.positions.reduce((s, p) => s + p.size + p.pnl, 0);
  portfolio.pnlHistory.push({ time: new Date(), value: portfolio.balance + openVal });

  return logs;
}

if (!isMainThread) {
  const { userId } = workerData;
  const INTERVAL = 5 * 60 * 1000;

  async function tick() {
    try {
      const logs = await runCycle(userId);
      const portfolio = getPortfolio(userId);
      parentPort.postMessage({ type: "logs", logs });
      parentPort.postMessage({ type: "portfolio", portfolio });
    } catch (err) {
      parentPort.postMessage({ type: "error", message: err.message });
    }
  }

  // Jalankan langsung pertama kali
  tick();
  setInterval(tick, INTERVAL);

  parentPort.postMessage({ type: "started", message: `FC_Agent bot running for ${userId}` });
}
