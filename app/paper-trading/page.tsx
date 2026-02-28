"use client";

import { useState, useEffect, useRef } from "react";
import sdk from "@farcaster/frame-sdk";

interface LimitOrder {
  id: string;
  coin: string;
  orderType: "BUY_LIMIT" | "SELL_LIMIT";
  positionType: string;
  limitPrice: number;
  currentPrice: number;
  tp1: number; tp2: number; tp3: number;
  sl: number;
  size: number;
  confidence: number;
  reason: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

interface Position {
  id: string;
  coin: string;
  type: "LONG" | "SHORT";
  orderType: string;
  entryPrice: number;
  currentPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  tp1: number; tp2: number; tp3: number;
  sl: number;
  status: string;
  closeReason?: string;
  openTime: string;
}

interface Portfolio {
  balance: number;
  reservedBalance: number;
  initialBalance: number;
  positions: Position[];
  pendingOrders: LimitOrder[];
  closedTrades: Position[];
  cancelledOrders: LimitOrder[];
  pnlHistory: { time: string; value: number }[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

export default function PaperTrading() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"orders" | "positions" | "history" | "chart">("orders");
  const [isLoading, setIsLoading] = useState(false);
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        const uid = context?.user?.fid?.toString() || "browser-" + Math.random().toString(36).substr(2, 9);
        setUserId(uid);
        fetchPortfolio(uid);
      } catch {
        const uid = "browser-" + Math.random().toString(36).substr(2, 9);
        setUserId(uid);
        fetchPortfolio(uid);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => fetchPortfolio(userId), 20000);
    return () => clearInterval(interval);
  }, [userId]);

  const fetchPortfolio = async (uid: string) => {
    try {
      const res = await fetch(`/api/paper-trading?userId=${uid}`);
      const data = await res.json();
      setPortfolio(data.portfolio);
      setLastUpdate(new Date());
    } catch {}
  };

  const handleAutoScan = async () => {
    setIsLoading(true);
    setScanResults([]);
    try {
      const res = await fetch("/api/paper-trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "auto_trade" }),
      });
      const data = await res.json();
      setScanResults(data.results || []);
      await fetchPortfolio(userId);
    } catch {}
    finally { setIsLoading(false); }
  };

  const handleCancelOrder = async (orderId: string) => {
    await fetch("/api/paper-trading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "cancel_order", orderId }),
    });
    fetchPortfolio(userId);
  };

  const handleReset = async () => {
    if (!confirm("Reset portfolio ke $1000?")) return;
    await fetch("/api/paper-trading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "reset" }),
    });
    setScanResults([]);
    fetchPortfolio(userId);
  };

  const totalValue = portfolio
    ? portfolio.balance + portfolio.reservedBalance +
      portfolio.positions.reduce((s, p) => s + p.size + p.pnl, 0)
    : 1000;
  const totalPnl = portfolio ? totalValue - portfolio.initialBalance : 0;
  const totalPnlPct = ((totalPnl / (portfolio?.initialBalance || 1000)) * 100).toFixed(2);
  const isProfitable = totalPnl >= 0;

  const getExpiryRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const renderChart = () => {
    if (!portfolio?.pnlHistory || portfolio.pnlHistory.length < 2) {
      return <div className="flex items-center justify-center h-32 text-xs" style={{ color: "#4a6580" }}>Belum ada data</div>;
    }
    const values = portfolio.pnlHistory.map((h) => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 320; const h = 100; const pad = 8;
    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = pad + ((max - v) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(" ");
    const color = isProfitable ? "#00ff88" : "#ff4444";
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${pad},${h - pad} ${points} ${w - pad},${h - pad}`} fill="url(#g)" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto"
      style={{ background: "#080b12", color: "#e2e8f0", fontFamily: "'DM Mono', monospace" }}>

      {/* Header */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #1e2d3d" }} className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <a href="/" className="text-xs px-2 py-1 rounded"
              style={{ background: "#1a1f2e", color: "#4a6580" }}>← Back</a>
            <div>
              <h1 className="text-sm font-bold" style={{ color: "#00d4ff" }}>📊 Paper Trading</h1>
              <p className="text-xs" style={{ color: "#4a6580" }}>Buy/Sell Limit · AI Auto Order · $1000</p>
            </div>
          </div>
          <button onClick={handleReset} className="text-xs px-2 py-1 rounded"
            style={{ background: "#1a1f2e", color: "#ff4444", border: "1px solid #ff444433" }}>
            Reset
          </button>
        </div>

        {/* Portfolio Stats */}
        <div className="rounded-xl p-3 mb-3"
          style={{ background: "#0d1a0d", border: `1px solid ${isProfitable ? "#00ff4433" : "#ff444433"}` }}>
          <div className="flex justify-between items-center mb-2">
            <div>
              <p className="text-xs" style={{ color: "#4a6580" }}>Total Value</p>
              <p className="text-xl font-bold" style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>
                ${totalValue.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: "#4a6580" }}>PnL</p>
              <p className="text-lg font-bold" style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>
                {isProfitable ? "+" : ""}{totalPnl.toFixed(2)} ({totalPnlPct}%)
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 pt-2" style={{ borderTop: "1px solid #1e2d3d" }}>
            {[
              { label: "Cash", value: `$${portfolio?.balance.toFixed(0) || 1000}` },
              { label: "Reserved", value: `$${portfolio?.reservedBalance.toFixed(0) || 0}`, color: "#ffaa00" },
              { label: "WR", value: `${portfolio?.winRate.toFixed(0) || 0}%`, color: "#00ff88" },
              { label: "Trades", value: portfolio?.totalTrades || 0 },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-xs" style={{ color: "#4a6580" }}>{s.label}</p>
                <p className="text-xs font-bold" style={{ color: s.color || "#e2e8f0" }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Scan Button */}
        <button onClick={handleAutoScan} disabled={isLoading}
          className="w-full py-3 rounded-xl text-sm font-bold"
          style={{
            background: isLoading ? "#1a1f2e" : "linear-gradient(135deg, #00d4ff, #0066ff)",
            color: isLoading ? "#4a6580" : "#fff",
            border: "none",
          }}>
          {isLoading ? "🔍 AI Scanning & Placing Limit Orders..." : "🤖 AI Scan & Place Limit Orders"}
        </button>

        {lastUpdate && (
          <p className="text-center text-xs mt-1" style={{ color: "#4a6580" }}>
            Updated: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Scan Results */}
      {scanResults.length > 0 && (
        <div className="px-3 py-2" style={{ background: "#0a0f1a", borderBottom: "1px solid #1e2d3d" }}>
          <p className="text-xs mb-1" style={{ color: "#4a6580" }}>🤖 Scan Results:</p>
          {scanResults.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs mb-0.5">
              <span>{r.action === "BUY_LIMIT" ? "🟢" : r.action === "SELL_LIMIT" ? "🔴" : "⏭️"}</span>
              <span className="font-bold">{r.coin.toUpperCase()}</span>
              {r.action !== "SKIP" && r.action !== "ERROR" && (
                <>
                  <span style={{ color: r.action === "BUY_LIMIT" ? "#00ff88" : "#ff4444" }}>{r.action}</span>
                  <span style={{ color: "#4a6580" }}>@ ${r.limitPrice?.toFixed(2)}</span>
                  <span style={{ color: "#00d4ff" }}>C:{r.confidence}/10</span>
                </>
              )}
              {(r.action === "SKIP" || r.action === "ERROR") && (
                <span style={{ color: "#4a6580" }} className="truncate">{r.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid #1e2d3d" }}>
        {(["orders", "positions", "history", "chart"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 text-xs"
            style={{
              background: activeTab === tab ? "#0d1117" : "transparent",
              color: activeTab === tab ? "#00d4ff" : "#4a6580",
              borderBottom: activeTab === tab ? "2px solid #00d4ff" : "2px solid transparent",
            }}>
            {tab === "orders" ? `Orders(${portfolio?.pendingOrders.length || 0})`
              : tab === "positions" ? `Open(${portfolio?.positions.length || 0})`
              : tab === "history" ? `History(${portfolio?.closedTrades.length || 0})`
              : "Chart"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Pending Orders */}
        {activeTab === "orders" && (
          <>
            {!portfolio?.pendingOrders.length && (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">📋</p>
                <p className="text-xs" style={{ color: "#4a6580" }}>
                  Tidak ada pending orders.{"\n"}Tekan AI Scan untuk mulai!
                </p>
              </div>
            )}
            {portfolio?.pendingOrders.map((order) => (
              <div key={order.id} className="rounded-xl p-3"
                style={{
                  background: "#0d1117",
                  border: `1px solid ${order.orderType === "BUY_LIMIT" ? "#00ff4433" : "#ff444433"}`,
                }}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-bold"
                      style={{
                        background: order.orderType === "BUY_LIMIT" ? "#0d2d1a" : "#2d0d0d",
                        color: order.orderType === "BUY_LIMIT" ? "#00ff88" : "#ff4444",
                      }}>
                      {order.orderType === "BUY_LIMIT" ? "BUY LIMIT" : "SELL LIMIT"}
                    </span>
                    <span className="text-sm font-bold">{order.coin}</span>
                    <span className="text-xs px-1 rounded"
                      style={{ background: "#1a1f2e", color: "#00d4ff" }}>
                      C:{order.confidence}/10
                    </span>
                  </div>
                  <button onClick={() => handleCancelOrder(order.id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: "#2d0d0d", color: "#ff4444" }}>
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                  <span style={{ color: "#4a6580" }}>
                    Limit: <span style={{ color: order.orderType === "BUY_LIMIT" ? "#00ff88" : "#ff4444" }}>
                      ${order.limitPrice.toFixed(4)}
                    </span>
                  </span>
                  <span style={{ color: "#4a6580" }}>
                    Now: <span style={{ color: "#e2e8f0" }}>${order.currentPrice.toFixed(4)}</span>
                  </span>
                  <span style={{ color: "#4a6580" }}>
                    Size: <span style={{ color: "#e2e8f0" }}>${order.size.toFixed(2)}</span>
                  </span>
                  <span style={{ color: "#4a6580" }}>
                    SL: <span style={{ color: "#ff4444" }}>${order.sl}</span>
                  </span>
                </div>

                <div className="flex gap-2 text-xs mb-2">
                  <span style={{ color: "#4a6580" }}>TP:</span>
                  <span style={{ color: "#00ff88" }}>${order.tp1}</span>
                  <span style={{ color: "#00ff88" }}>${order.tp2}</span>
                  <span style={{ color: "#00ff88" }}>${order.tp3}</span>
                </div>

                <div className="flex justify-between text-xs" style={{ color: "#4a6580" }}>
                  <span>⏰ Expires: {getExpiryRemaining(order.expiresAt)}</span>
                  <span className="truncate ml-2" style={{ maxWidth: "60%" }}>💬 {order.reason}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Open Positions */}
        {activeTab === "positions" && (
          <>
            {!portfolio?.positions.length && (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">⚡</p>
                <p className="text-xs" style={{ color: "#4a6580" }}>
                  Tidak ada posisi terbuka.{"\n"}Posisi akan terbuka otomatis saat limit order terisi.
                </p>
              </div>
            )}
            {portfolio?.positions.map((pos) => (
              <div key={pos.id} className="rounded-xl p-3"
                style={{
                  background: "#0d1117",
                  border: `1px solid ${pos.pnl >= 0 ? "#00ff4433" : "#ff444433"}`,
                }}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-bold"
                      style={{
                        background: pos.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: pos.type === "LONG" ? "#00ff88" : "#ff4444",
                      }}>
                      {pos.type}
                    </span>
                    <span className="text-sm font-bold">{pos.coin}</span>
                    <span className="text-xs" style={{ color: "#4a6580" }}>
                      via {pos.orderType}
                    </span>
                  </div>
                  <span className="text-sm font-bold"
                    style={{ color: pos.pnl >= 0 ? "#00ff88" : "#ff4444" }}>
                    {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span style={{ color: "#4a6580" }}>Entry: <span style={{ color: "#e2e8f0" }}>${pos.entryPrice.toFixed(4)}</span></span>
                  <span style={{ color: "#4a6580" }}>Now: <span style={{ color: "#e2e8f0" }}>${pos.currentPrice.toFixed(4)}</span></span>
                  <span style={{ color: "#4a6580" }}>Size: <span style={{ color: "#e2e8f0" }}>${pos.size.toFixed(2)}</span></span>
                  <span style={{ color: "#4a6580" }}>SL: <span style={{ color: "#ff4444" }}>${pos.sl}</span></span>
                </div>
                <div className="flex gap-2 mt-2 text-xs">
                  <span style={{ color: "#4a6580" }}>TP:</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp1}</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp2}</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp3}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {/* History */}
        {activeTab === "history" && (
          <>
            {!portfolio?.closedTrades.length && (
              <div className="text-center py-8">
                <p className="text-xs" style={{ color: "#4a6580" }}>Belum ada trade history</p>
              </div>
            )}
            {portfolio?.closedTrades.map((trade) => (
              <div key={trade.id} className="rounded-lg p-3 flex items-center justify-between"
                style={{
                  background: "#0d1117",
                  border: `1px solid ${trade.pnl >= 0 ? "#00ff4422" : "#ff444422"}`,
                }}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 rounded font-bold"
                      style={{
                        background: trade.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: trade.type === "LONG" ? "#00ff88" : "#ff4444",
                      }}>
                      {trade.type}
                    </span>
                    <span className="text-xs font-bold">{trade.coin}</span>
                    <span className="text-xs px-1.5 rounded"
                      style={{
                        background: trade.closeReason === "SL" ? "#2d0d0d" : "#0d2d1a",
                        color: trade.closeReason === "SL" ? "#ff4444" : "#00ff88",
                      }}>
                      {trade.closeReason}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "#4a6580" }}>
                    ${trade.entryPrice.toFixed(4)} → ${trade.currentPrice.toFixed(4)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: trade.pnl >= 0 ? "#00ff88" : "#ff4444" }}>
                    {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(2)}
                  </p>
                  <p className="text-xs" style={{ color: "#4a6580" }}>{trade.pnlPercent.toFixed(2)}%</p>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Chart */}
        {activeTab === "chart" && (
          <div>
            <div className="rounded-xl p-4 mb-4"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}>
              <p className="text-xs mb-2" style={{ color: "#4a6580" }}>Portfolio Value</p>
              {renderChart()}
              <div className="flex justify-between mt-2 text-xs" style={{ color: "#4a6580" }}>
                <span>Start: $1000</span>
                <span style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>
                  Now: ${totalValue.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Trades", value: portfolio?.totalTrades || 0, color: "#00d4ff" },
                { label: "Win Rate", value: `${portfolio?.winRate.toFixed(0) || 0}%`, color: "#00ff88" },
                { label: "Wins", value: portfolio?.wins || 0, color: "#00ff88" },
                { label: "Losses", value: portfolio?.losses || 0, color: "#ff4444" },
                { label: "PnL", value: `$${totalPnl.toFixed(2)}`, color: isProfitable ? "#00ff88" : "#ff4444" },
                { label: "Return", value: `${totalPnlPct}%`, color: isProfitable ? "#00ff88" : "#ff4444" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-3 text-center"
                  style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}>
                  <p className="text-xs mb-1" style={{ color: "#4a6580" }}>{s.label}</p>
                  <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
