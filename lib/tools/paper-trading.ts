export type OrderType = "MARKET" | "BUY_LIMIT" | "SELL_LIMIT";
export type PositionType = "LONG" | "SHORT";
export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "EXPIRED";
export type CloseReason = "TP1" | "TP2" | "TP3" | "SL" | "MANUAL";

export interface LimitOrder {
  id: string;
  coin: string;
  coinId: string;
  orderType: "BUY_LIMIT" | "SELL_LIMIT";
  positionType: PositionType;
  limitPrice: number;      // harga target untuk eksekusi
  currentPrice: number;    // harga saat order dibuat
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  size: number;            // USD amount
  riskPercent: number;
  status: OrderStatus;
  reason: string;          // AI reasoning
  confidence: number;
  createdAt: Date;
  expiresAt: Date;         // 72 jam dari createdAt
  filledAt?: Date;
}

export interface Position {
  id: string;
  coin: string;
  coinId: string;
  type: PositionType;
  orderType: OrderType;
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
  closeReason?: CloseReason;
  openTime: Date;
  closeTime?: Date;
  fromOrderId?: string;    // referensi limit order
}

export interface Portfolio {
  userId: string;
  balance: number;
  reservedBalance: number; // balance yang di-reserve untuk pending limit orders
  initialBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  positions: Position[];
  pendingOrders: LimitOrder[];
  closedTrades: Position[];
  cancelledOrders: LimitOrder[];
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  pnlHistory: { time: Date; value: number }[];
}

const EXPIRY_HOURS = 72;
const portfolios = new Map<string, Portfolio>();

export function getPortfolio(userId: string): Portfolio {
  if (!portfolios.has(userId)) {
    portfolios.set(userId, {
      userId,
      balance: 1000,
      reservedBalance: 0,
      initialBalance: 1000,
      totalPnl: 0,
      totalPnlPercent: 0,
      positions: [],
      pendingOrders: [],
      closedTrades: [],
      cancelledOrders: [],
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

// ==================== PLACE LIMIT ORDER ====================
export function placeLimitOrder(
  userId: string,
  coin: string,
  coinId: string,
  orderType: "BUY_LIMIT" | "SELL_LIMIT",
  currentPrice: number,
  limitPrice: number,
  tp1: number,
  tp2: number,
  tp3: number,
  sl: number,
  confidence: number,
  reason: string,
  riskPercent: number = 10
): { success: boolean; message: string; order?: LimitOrder } {
  const portfolio = getPortfolio(userId);

  // Max 5 pending orders
  if (portfolio.pendingOrders.length >= 5) {
    return { success: false, message: "Max 5 pending orders. Cancel order lama dulu." };
  }

  // Cek sudah ada order/posisi untuk coin ini
  const existingOrder = portfolio.pendingOrders.find((o) => o.coinId === coinId);
  const existingPos = portfolio.positions.find((p) => p.coinId === coinId);
  if (existingOrder) return { success: false, message: `Sudah ada pending order untuk ${coin}` };
  if (existingPos) return { success: false, message: `Sudah ada open posisi untuk ${coin}` };

  // Validasi limit price
  if (orderType === "BUY_LIMIT" && limitPrice >= currentPrice) {
    return { success: false, message: `Buy Limit harus di BAWAH harga saat ini ($${currentPrice})` };
  }
  if (orderType === "SELL_LIMIT" && limitPrice <= currentPrice) {
    return { success: false, message: `Sell Limit harus di ATAS harga saat ini ($${currentPrice})` };
  }

  // Tentukan posisi type
  const positionType: PositionType = orderType === "BUY_LIMIT" ? "LONG" : "SHORT";

  // Validasi TP/SL
  if (positionType === "LONG") {
    if (sl >= limitPrice) return { success: false, message: "SL harus di bawah limit price untuk LONG" };
    if (tp1 <= limitPrice) return { success: false, message: "TP harus di atas limit price untuk LONG" };
  } else {
    if (sl <= limitPrice) return { success: false, message: "SL harus di atas limit price untuk SHORT" };
    if (tp1 >= limitPrice) return { success: false, message: "TP harus di bawah limit price untuk SHORT" };
  }

  const size = parseFloat((portfolio.balance * (riskPercent / 100)).toFixed(2));
  const availableBalance = portfolio.balance - portfolio.reservedBalance;

  if (size < 5) return { success: false, message: "Balance tidak cukup" };
  if (size > availableBalance) return { success: false, message: `Balance tidak cukup. Available: $${availableBalance.toFixed(2)}` };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);

  const order: LimitOrder = {
    id: `LO-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    coin: coin.toUpperCase().replace("USDT", ""),
    coinId,
    orderType,
    positionType,
    limitPrice,
    currentPrice,
    tp1, tp2, tp3, sl,
    size,
    riskPercent,
    status: "PENDING",
    reason,
    confidence,
    createdAt: now,
    expiresAt,
  };

  // Reserve balance
  portfolio.reservedBalance = parseFloat((portfolio.reservedBalance + size).toFixed(2));
  portfolio.pendingOrders.push(order);

  const distancePct = Math.abs((limitPrice - currentPrice) / currentPrice * 100).toFixed(2);

  return {
    success: true,
    message: `${orderType} ${coin} @ $${limitPrice} (${distancePct}% dari harga) | Expires: 72h`,
    order,
  };
}

// ==================== CANCEL ORDER ====================
export function cancelOrder(
  userId: string,
  orderId: string
): { success: boolean; message: string } {
  const portfolio = getPortfolio(userId);
  const idx = portfolio.pendingOrders.findIndex((o) => o.id === orderId);

  if (idx === -1) return { success: false, message: "Order tidak ditemukan" };

  const order = portfolio.pendingOrders[idx];
  order.status = "CANCELLED";

  // Release reserved balance
  portfolio.reservedBalance = parseFloat(
    Math.max(0, portfolio.reservedBalance - order.size).toFixed(2)
  );

  portfolio.cancelledOrders.unshift(order);
  portfolio.pendingOrders.splice(idx, 1);

  return { success: true, message: `Order ${order.coin} ${order.orderType} dibatalkan` };
}

// ==================== CHECK & FILL LIMIT ORDERS ====================
export function checkAndFillOrders(
  userId: string,
  priceMap: Record<string, number>
): { filled: LimitOrder[]; expired: LimitOrder[] } {
  const portfolio = getPortfolio(userId);
  const filled: LimitOrder[] = [];
  const expired: LimitOrder[] = [];
  const now = new Date();
  const remaining: LimitOrder[] = [];

  for (const order of portfolio.pendingOrders) {
    const currentPrice = priceMap[order.coinId];
    if (!currentPrice) {
      remaining.push(order);
      continue;
    }

    // Cek expired
    if (now >= order.expiresAt) {
      order.status = "EXPIRED";
      portfolio.reservedBalance = parseFloat(
        Math.max(0, portfolio.reservedBalance - order.size).toFixed(2)
      );
      portfolio.cancelledOrders.unshift(order);
      expired.push(order);
      continue;
    }

    // Cek apakah limit price tercapai
    const isFilled =
      (order.orderType === "BUY_LIMIT" && currentPrice <= order.limitPrice) ||
      (order.orderType === "SELL_LIMIT" && currentPrice >= order.limitPrice);

    if (isFilled && portfolio.positions.length < 3) {
      // Execute order → buat posisi
      order.status = "FILLED";
      order.filledAt = now;

      const position: Position = {
        id: `POS-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        coin: order.coin,
        coinId: order.coinId,
        type: order.positionType,
        orderType: order.orderType,
        entryPrice: order.limitPrice, // filled di limit price
        currentPrice: currentPrice,
        size: order.size,
        quantity: order.size / order.limitPrice,
        tp1: order.tp1,
        tp2: order.tp2,
        tp3: order.tp3,
        sl: order.sl,
        pnl: 0,
        pnlPercent: 0,
        status: "OPEN",
        openTime: now,
        fromOrderId: order.id,
      };

      // Deduct dari balance (sudah di-reserve)
      portfolio.balance = parseFloat((portfolio.balance - order.size).toFixed(2));
      portfolio.reservedBalance = parseFloat(
        Math.max(0, portfolio.reservedBalance - order.size).toFixed(2)
      );

      portfolio.positions.push(position);
      filled.push(order);
    } else {
      remaining.push(order);
    }
  }

  portfolio.pendingOrders = remaining;
  return { filled, expired };
}

// ==================== UPDATE OPEN POSITIONS ====================
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

    if (pos.type === "LONG") {
      pos.pnl = parseFloat(((currentPrice - pos.entryPrice) * pos.quantity).toFixed(2));
    } else {
      pos.pnl = parseFloat(((pos.entryPrice - currentPrice) * pos.quantity).toFixed(2));
    }
    pos.pnlPercent = parseFloat(((pos.pnl / pos.size) * 100).toFixed(2));

    let closeReason: CloseReason | null = null;

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

      portfolio.balance = parseFloat((portfolio.balance + pos.size + pos.pnl).toFixed(2));
      portfolio.totalPnl = parseFloat((portfolio.totalPnl + pos.pnl).toFixed(2));
      portfolio.totalTrades++;
      if (pos.pnl > 0) portfolio.wins++; else portfolio.losses++;
      portfolio.winRate = parseFloat(((portfolio.wins / portfolio.totalTrades) * 100).toFixed(1));

      portfolio.closedTrades.unshift({ ...pos });
      if (portfolio.closedTrades.length > 100) portfolio.closedTrades.pop();

      closed.push(pos);
    } else {
      remaining.push(pos);
      updated.push(pos);
    }
  }

  portfolio.positions = remaining;

  // Update PnL history
  const openValue = remaining.reduce((s, p) => s + p.size + p.pnl, 0);
  const totalValue = parseFloat((portfolio.balance + portfolio.reservedBalance + openValue).toFixed(2));
  portfolio.totalPnlPercent = parseFloat(
    (((totalValue - portfolio.initialBalance) / portfolio.initialBalance) * 100).toFixed(2)
  );
  portfolio.pnlHistory.push({ time: new Date(), value: totalValue });
  if (portfolio.pnlHistory.length > 500) portfolio.pnlHistory = portfolio.pnlHistory.slice(-500);

  return { closed, updated };
}

export function getPortfolioSummary(userId: string): string {
  const p = getPortfolio(userId);
  const openValue = p.positions.reduce((s, pos) => s + pos.size + pos.pnl, 0);
  const totalValue = parseFloat((p.balance + p.reservedBalance + openValue).toFixed(2));
  const totalPnl = parseFloat((totalValue - p.initialBalance).toFixed(2));
  const pct = ((totalPnl / p.initialBalance) * 100).toFixed(2);

  return `💼 PORTFOLIO
💵 Cash: $${p.balance.toFixed(2)} | Reserved: $${p.reservedBalance.toFixed(2)}
📊 Total: $${totalValue} ${totalPnl >= 0 ? "🟢" : "🔴"} $${totalPnl} (${pct}%)
🎯 WR: ${p.winRate}% (${p.wins}W/${p.losses}L)
⚡ Positions: ${p.positions.length}/3 | Pending: ${p.pendingOrders.length}/5`;
}
