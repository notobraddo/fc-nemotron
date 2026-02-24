// Paper Trading Engine — simpan state di memory (upgrade ke DB untuk production)

export interface Position {
  id: string;
  coin: string;
  coinId: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  size: number;        // USD amount
  quantity: number;    // coin amount
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
  balance: number;       // available cash
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

// In-memory store
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
  riskPercent: number = 10 // pakai 10% dari balance per trade
): { success: boolean; message: string; position?: Position } {
  const portfolio = getPortfolio(userId);

  // Max 3 posisi open sekaligus
  if (portfolio.positions.length >= 3) {
    return { success: false, message: "Max 3 posisi open. Tunggu posisi sebelumnya close." };
  }

  const size = portfolio.balance * (riskPercent / 100);
  if (size < 10) {
    return { success: false, message: "Balance tidak cukup untuk open posisi." };
  }

  const quantity = size / entryPrice;

  const position: Position = {
    id: Date.now().toString(),
    coin: coin.toUpperCase(),
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

  portfolio.balance -= size;
  portfolio.positions.push(position);

  return { success: true, message: `Posisi ${type} ${coin} dibuka di $${entryPrice}`, position };
}

export function updatePositions(
  userId: string,
  priceMap: Record<string, number>
): { closed: Position[]; updated: Position[] } {
  const portfolio = getPortfolio(userId);
  const closed: Position[] = [];
  const updated: Position[] = [];

  portfolio.positions = portfolio.positions.filter((pos) => {
    const currentPrice = priceMap[pos.coinId] || pos.currentPrice;
    pos.currentPrice = currentPrice;

    // Hitung PnL
    if (pos.type === "LONG") {
      pos.pnl = (currentPrice - pos.entryPrice) * pos.quantity;
    } else {
      pos.pnl = (pos.entryPrice - currentPrice) * pos.quantity;
    }
    pos.pnlPercent = (pos.pnl / pos.size) * 100;

    // Cek TP/SL
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

      // Return size + pnl ke balance
      portfolio.balance += pos.size + pos.pnl;
      portfolio.totalPnl += pos.pnl;

      // Update stats
      portfolio.totalTrades++;
      if (pos.pnl > 0) portfolio.wins++;
      else portfolio.losses++;
      portfolio.winRate = (portfolio.wins / portfolio.totalTrades) * 100;

      portfolio.closedTrades.unshift(pos);
      if (portfolio.closedTrades.length > 50) portfolio.closedTrades.pop();

      // Update PnL history
      const totalValue = portfolio.balance + portfolio.positions.reduce((s, p) => s + p.size, 0);
      portfolio.totalPnlPercent = ((totalValue - portfolio.initialBalance) / portfolio.initialBalance) * 100;
      portfolio.pnlHistory.push({ time: new Date(), value: totalValue });

      closed.push(pos);
      return false; // remove dari positions
    }

    updated.push(pos);
    return true;
  });

  return { closed, updated };
}

export function getPortfolioSummary(userId: string): string {
  const p = getPortfolio(userId);
  const totalValue = p.balance + p.positions.reduce((s, pos) => s + pos.size + pos.pnl, 0);
  const totalPnl = totalValue - p.initialBalance;
  const totalPnlPct = ((totalPnl / p.initialBalance) * 100).toFixed(2);

  let summary = `💼 PORTFOLIO SUMMARY
💵 Balance: $${p.balance.toFixed(2)}
📊 Total Value: $${totalValue.toFixed(2)}
${totalPnl >= 0 ? "🟢" : "🔴"} Total PnL: $${totalPnl.toFixed(2)} (${totalPnlPct}%)
🎯 Win Rate: ${p.winRate.toFixed(0)}% (${p.wins}W/${p.losses}L)
📈 Total Trades: ${p.totalTrades}

`;

  if (p.positions.length > 0) {
    summary += `⚡ OPEN POSITIONS (${p.positions.length})\n`;
    p.positions.forEach((pos) => {
      const pnlEmoji = pos.pnl >= 0 ? "🟢" : "🔴";
      summary += `• ${pos.type} ${pos.coin} @ $${pos.entryPrice.toFixed(4)}
  Current: $${pos.currentPrice.toFixed(4)} ${pnlEmoji} $${pos.pnl.toFixed(2)} (${pos.pnlPercent.toFixed(2)}%)
  SL: $${pos.sl} | TP1: $${pos.tp1} | TP2: $${pos.tp2} | TP3: $${pos.tp3}\n\n`;
    });
  } else {
    summary += "⚡ No open positions\n";
  }

  return summary;
}
