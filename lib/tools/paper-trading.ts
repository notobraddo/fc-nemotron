export interface Position {
  id: string;
  coin: string;
  coinId: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  size: number;
  quantity: number;
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  pnl: number;
  pnlPercent: number;
  status: "OPEN" | "CLOSED";
  closeReason?: "TP1" | "TP2" | "TP3" | "SL" | "MANUAL";
  openTime: Date;
  closeTime?: Date;
}

export interface Portfolio {
  userId: string;
  balance: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  positions: Position[];
  closedTrades: Position[];
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  pnlHistory: { time: Date; value: number }[];
}

const portfolios = new Map<string, Portfolio>();

export function getPortfolio(userId: string): Portfolio {
  if (!portfolios.has(userId)) {
    portfolios.set(userId, {
      userId,
      balance: 1000,
      initialBalance: 1000,
      totalPnl: 0,
      totalPnlPercent: 0,
      positions: [],
      closedTrades: [],
      winRate: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      pnlHistory: [{ time: new Date(), value: 1000 }],
    });
  }
  return portfolios.get(userId)!;
}

export function resetPortfolio(userId: string): Portfolio {
  portfolios.delete(userId);
  return getPortfolio(userId);
}

export function openPosition(
  userId: string,
  coin: string,
  coinId: string,
  type: "LONG" | "SHORT",
  entryPrice: number,
  tp1: number,
  tp2: number,
  tp3: number,
  sl: number,
  riskPercent: number = 10
): { success: boolean; message: string; position?: Position } {
  const portfolio = getPortfolio(userId);

  if (portfolio.positions.length >= 3) {
    return { success: false, message: "Max 3 posisi open sekaligus" };
  }

  // Validasi harga TP/SL
  if (type === "LONG") {
    if (sl >= entryPrice) return { success: false, message: "SL harus di bawah entry untuk LONG" };
    if (tp1 <= entryPrice) return { success: false, message: "TP harus di atas entry untuk LONG" };
  } else {
    if (sl <= entryPrice) return { success: false, message: "SL harus di atas entry untuk SHORT" };
    if (tp1 >= entryPrice) return { success: false, message: "TP harus di bawah entry untuk SHORT" };
  }

  const size = parseFloat((portfolio.balance * (riskPercent / 100)).toFixed(2));
  if (size < 5) return { success: false, message: "Balance tidak cukup" };

  const quantity = size / entryPrice;

  const position: Position = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    coin: coin.toUpperCase().replace("USDT", ""),
    coinId,
    type,
    entryPrice,
    currentPrice: entryPrice,
    size,
    quantity,
    tp1, tp2, tp3, sl,
    pnl: 0,
    pnlPercent: 0,
    status: "OPEN",
    openTime: new Date(),
  };

  portfolio.balance = parseFloat((portfolio.balance - size).toFixed(2));
  portfolio.positions.push(position);

  return { success: true, message: `${type} ${coin} @ $${entryPrice}`, position };
}

export function updatePositions(
  userId: string,
  priceMap: Record<string, number>
): { closed: Position[]; updated: Position[] } {
  const portfolio = getPortfolio(userId);
  const closed: Position[] = [];
  const updated: Position[] = [];

  const remaining: Position[] = [];

  for (const pos of portfolio.positions) {
    const currentPrice = priceMap[pos.coinId] ?? pos.currentPrice;
    pos.currentPrice = currentPrice;

    // Hitung PnL
    if (pos.type === "LONG") {
      pos.pnl = parseFloat(((currentPrice - pos.entryPrice) * pos.quantity).toFixed(2));
    } else {
      pos.pnl = parseFloat(((pos.entryPrice - currentPrice) * pos.quantity).toFixed(2));
    }
    pos.pnlPercent = parseFloat(((pos.pnl / pos.size) * 100).toFixed(2));

    // Cek TP/SL hit
    let closeReason: Position["closeReason"] | null = null;

    if (pos.type === "LONG") {
      if (currentPrice <= pos.sl) closeReason = "SL";
      else if (currentPrice >= pos.tp3) closeReason = "TP3";
      else if (currentPrice >= pos.tp2) closeReason = "TP2";
      else if (currentPrice >= pos.tp1) closeReason = "TP1";
    } else {
      if (currentPrice >= pos.sl) closeReason = "SL";
      else if (currentPrice <= pos.tp3) closeReason = "TP3";
      else if (currentPrice <= pos.tp2) closeReason = "TP2";
      else if (currentPrice <= pos.tp1) closeReason = "TP1";
    }

    if (closeReason) {
      pos.status = "CLOSED";
      pos.closeReason = closeReason;
      pos.closeTime = new Date();

      // Return modal + PnL ke balance
      portfolio.balance = parseFloat((portfolio.balance + pos.size + pos.pnl).toFixed(2));

      // Update stats
      portfolio.totalTrades++;
      if (pos.pnl > 0) portfolio.wins++;
      else portfolio.losses++;
      portfolio.winRate = parseFloat(((portfolio.wins / portfolio.totalTrades) * 100).toFixed(1));
      portfolio.totalPnl = parseFloat((portfolio.totalPnl + pos.pnl).toFixed(2));

      portfolio.closedTrades.unshift({ ...pos });
      if (portfolio.closedTrades.length > 100) portfolio.closedTrades.pop();

      closed.push(pos);
    } else {
      remaining.push(pos);
      updated.push(pos);
    }
  }

  portfolio.positions = remaining;

  // Update PnL history — hitung total value setelah posisi closed
  const openValue = remaining.reduce((s, p) => s + p.size + p.pnl, 0);
  const totalValue = parseFloat((portfolio.balance + openValue).toFixed(2));
  portfolio.totalPnlPercent = parseFloat(
    (((totalValue - portfolio.initialBalance) / portfolio.initialBalance) * 100).toFixed(2)
  );
  portfolio.pnlHistory.push({ time: new Date(), value: totalValue });

  // Keep max 500 history points
  if (portfolio.pnlHistory.length > 500) {
    portfolio.pnlHistory = portfolio.pnlHistory.slice(-500);
  }

  return { closed, updated };
}

export function getPortfolioSummary(userId: string): string {
  const p = getPortfolio(userId);
  const openValue = p.positions.reduce((s, pos) => s + pos.size + pos.pnl, 0);
  const totalValue = parseFloat((p.balance + openValue).toFixed(2));
  const totalPnl = parseFloat((totalValue - p.initialBalance).toFixed(2));
  const totalPnlPct = ((totalPnl / p.initialBalance) * 100).toFixed(2);

  return `💼 PORTFOLIO
💵 Cash: $${p.balance.toFixed(2)}
📊 Total: $${totalValue.toFixed(2)}
${totalPnl >= 0 ? "🟢" : "🔴"} PnL: $${totalPnl} (${totalPnlPct}%)
🎯 WR: ${p.winRate}% (${p.wins}W/${p.losses}L/${p.totalTrades} trades)
⚡ Open: ${p.positions.length}/3`;
}
