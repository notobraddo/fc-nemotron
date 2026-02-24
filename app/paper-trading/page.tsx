"use client";

import { useState, useEffect, useRef } from "react";
import sdk from "@farcaster/frame-sdk";

interface Position {
  id: string;
  coin: string;
  type: "LONG" | "SHORT";
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
  closeTime?: string;
}

interface Portfolio {
  balance: number;
  initialBalance: number;
  positions: Position[];
  closedTrades: Position[];
  pnlHistory: { time: string; value: number }[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

interface TradeResult {
  coin: string;
  action: string;
  type?: string;
  entry?: number;
  tp1?: number; tp2?: number; tp3?: number;
  sl?: number;
  confidence?: number;
  reason?: string;
  success?: boolean;
  message?: string;
}

export default function PaperTrading() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoTrading, setIsAutoTrading] = useState(false);
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"positions" | "history" | "chart">("positions");
  const [tradeLog, setTradeLog] = useState<TradeResult[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const autoTradeRef = useRef<NodeJS.Timeout | null>(null);

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

  // Auto refresh setiap 30 detik kalau ada open positions
  useEffect(() => {
    const interval = setInterval(() => {
      if (userId && portfolio?.positions && portfolio.positions.length > 0) {
        fetchPortfolio(userId);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [userId, portfolio]);

  const fetchPortfolio = async (uid: string) => {
    try {
      const res = await fetch(`/api/paper-trading?userId=${uid}`);
      const data = await res.json();
      setPortfolio(data.portfolio);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    }
  };

  const handleAutoTrade = async () => {
    if (!userId) return;
    setIsAutoTrading(true);
    setTradeLog([]);

    try {
      const res = await fetch("/api/paper-trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "auto_trade" }),
      });
      const data = await res.json();
      setTradeLog(data.results || []);
      await fetchPortfolio(userId);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAutoTrading(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset portfolio ke $1000?")) return;
    await fetch("/api/paper-trading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "reset" }),
    });
    setTradeLog([]);
    await fetchPortfolio(userId);
  };

  const totalValue = portfolio
    ? portfolio.balance + portfolio.positions.reduce((s, p) => s + p.size + p.pnl, 0)
    : 1000;
  const totalPnl = portfolio ? totalValue - portfolio.initialBalance : 0;
  const totalPnlPct = portfolio ? ((totalPnl / portfolio.initialBalance) * 100).toFixed(2) : "0.00";
  const isProfitable = totalPnl >= 0;

  // Simple line chart using SVG
  const renderChart = () => {
    if (!portfolio?.pnlHistory || portfolio.pnlHistory.length < 2) {
      return (
        <div className="flex items-center justify-center h-40 text-xs" style={{ color: "#4a6580" }}>
          Belum ada data chart. Mulai trading dulu!
        </div>
      );
    }

    const history = portfolio.pnlHistory;
    const values = history.map((h) => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 320;
    const h = 120;
    const pad = 10;

    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = pad + ((max - v) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(" ");

    const color = isProfitable ? "#00ff88" : "#ff4444";

    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={pad} y1={pad + pct * (h - pad * 2)}
            x2={w - pad} y2={pad + pct * (h - pad * 2)}
            stroke="#1e2d3d" strokeWidth="1"
          />
        ))}
        {/* Area fill */}
        <polygon
          points={`${pad},${h - pad} ${points} ${w - pad},${h - pad}`}
          fill="url(#chartGrad)"
        />
        {/* Line */}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
        {/* Labels */}
        <text x={pad} y={h} fontSize="9" fill="#4a6580">${min.toFixed(0)}</text>
        <text x={pad} y={pad + 6} fontSize="9" fill="#4a6580">${max.toFixed(0)}</text>
      </svg>
    );
  };

  return (
    <div
      className="flex flex-col h-screen max-w-md mx-auto"
      style={{ background: "#080b12", color: "#e2e8f0", fontFamily: "'DM Mono', monospace" }}
    >
      {/* Header */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #1e2d3d" }} className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <a href="/" className="text-xs px-2 py-1 rounded" style={{ background: "#1a1f2e", color: "#4a6580" }}>
              ← Back
            </a>
            <div>
              <h1 className="text-sm font-bold" style={{ color: "#00d4ff" }}>📊 Paper Trading</h1>
              <p className="text-xs" style={{ color: "#4a6580" }}>AI Auto Trader · $1000 Modal</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="text-xs px-2 py-1 rounded"
            style={{ background: "#1a1f2e", color: "#ff4444", border: "1px solid #ff444433" }}
          >
            Reset
          </button>
        </div>

        {/* Portfolio Stats */}
        <div
          className="rounded-xl p-3 mb-3"
          style={{ background: "#0d1a0d", border: `1px solid ${isProfitable ? "#00ff4433" : "#ff444433"}` }}
        >
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs" style={{ color: "#4a6580" }}>Total Value</p>
              <p className="text-xl font-bold" style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>
                ${totalValue.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: "#4a6580" }}>Total PnL</p>
              <p className="text-lg font-bold" style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>
                {isProfitable ? "+" : ""}{totalPnl.toFixed(2)} ({totalPnlPct}%)
              </p>
            </div>
          </div>
          <div className="flex gap-4 mt-2 pt-2" style={{ borderTop: "1px solid #1e2d3d" }}>
            <div className="text-xs">
              <span style={{ color: "#4a6580" }}>Cash: </span>
              <span style={{ color: "#e2e8f0" }}>${portfolio?.balance.toFixed(2) || "1000.00"}</span>
            </div>
            <div className="text-xs">
              <span style={{ color: "#4a6580" }}>Win Rate: </span>
              <span style={{ color: "#00ff88" }}>{portfolio?.winRate.toFixed(0) || 0}%</span>
            </div>
            <div className="text-xs">
              <span style={{ color: "#4a6580" }}>Trades: </span>
              <span style={{ color: "#e2e8f0" }}>{portfolio?.totalTrades || 0}</span>
            </div>
          </div>
        </div>

        {/* Auto Trade Button */}
        <button
          onClick={handleAutoTrade}
          disabled={isAutoTrading}
          className="w-full py-3 rounded-xl text-sm font-bold transition-all"
          style={{
            background: isAutoTrading
              ? "#1a1f2e"
              : "linear-gradient(135deg, #00d4ff, #0066ff)",
            color: isAutoTrading ? "#4a6580" : "#fff",
            border: "none",
            letterSpacing: "0.05em",
          }}
        >
          {isAutoTrading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span> AI Scanning Market...
            </span>
          ) : (
            "🤖 AI Auto Trade"
          )}
        </button>

        {lastUpdate && (
          <p className="text-center text-xs mt-1" style={{ color: "#4a6580" }}>
            Updated: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Trade Log */}
      {tradeLog.length > 0 && (
        <div className="px-4 py-2" style={{ background: "#0a0f1a", borderBottom: "1px solid #1e2d3d" }}>
          <p className="text-xs mb-2" style={{ color: "#4a6580" }}>🤖 AI Scan Results:</p>
          <div className="space-y-1">
            {tradeLog.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span style={{ color: r.action === "OPEN" ? "#00ff88" : "#4a6580" }}>
                  {r.action === "OPEN" ? "✅" : "⏭️"}
                </span>
                <span style={{ color: "#e2e8f0" }}>{r.coin.toUpperCase()}</span>
                {r.action === "OPEN" && (
                  <>
                    <span style={{ color: r.type === "LONG" ? "#00ff88" : "#ff4444" }}>{r.type}</span>
                    <span style={{ color: "#4a6580" }}>@${r.entry?.toFixed(2)}</span>
                    <span style={{ color: "#00d4ff" }}>C:{r.confidence}/10</span>
                  </>
                )}
                {r.action === "SKIP" && (
                  <span style={{ color: "#4a6580" }}>{r.reason}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid #1e2d3d" }}>
        {(["positions", "history", "chart"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 text-xs capitalize transition-all"
            style={{
              background: activeTab === tab ? "#0d1117" : "transparent",
              color: activeTab === tab ? "#00d4ff" : "#4a6580",
              borderBottom: activeTab === tab ? "2px solid #00d4ff" : "2px solid transparent",
            }}
          >
            {tab === "positions" ? `Positions (${portfolio?.positions.length || 0})` :
             tab === "history" ? `History (${portfolio?.closedTrades.length || 0})` :
             "PnL Chart"}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">

        {/* Positions Tab */}
        {activeTab === "positions" && (
          <div className="space-y-3">
            {portfolio?.positions.length === 0 && (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">📭</p>
                <p className="text-xs" style={{ color: "#4a6580" }}>
                  Tidak ada posisi terbuka.{"\n"}Tekan AI Auto Trade untuk mulai!
                </p>
              </div>
            )}
            {portfolio?.positions.map((pos) => (
              <div
                key={pos.id}
                className="rounded-xl p-3"
                style={{
                  background: "#0d1117",
                  border: `1px solid ${pos.pnl >= 0 ? "#00ff4433" : "#ff444433"}`,
                }}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded font-bold"
                      style={{
                        background: pos.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: pos.type === "LONG" ? "#00ff88" : "#ff4444",
                      }}
                    >
                      {pos.type}
                    </span>
                    <span className="text-sm font-bold">{pos.coin}</span>
                  </div>
                  <span
                    className="text-sm font-bold"
                    style={{ color: pos.pnl >= 0 ? "#00ff88" : "#ff4444" }}
                  >
                    {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: "#4a6580" }}>
                  <span>Entry: <span style={{ color: "#e2e8f0" }}>${pos.entryPrice.toFixed(4)}</span></span>
                  <span>Now: <span style={{ color: "#e2e8f0" }}>${pos.currentPrice.toFixed(4)}</span></span>
                  <span>Size: <span style={{ color: "#e2e8f0" }}>${pos.size.toFixed(2)}</span></span>
                  <span>SL: <span style={{ color: "#ff4444" }}>${pos.sl}</span></span>
                </div>
                <div className="flex gap-2 mt-2 text-xs">
                  <span style={{ color: "#4a6580" }}>TP:</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp1}</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp2}</span>
                  <span style={{ color: "#00ff88" }}>${pos.tp3}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="space-y-2">
            {portfolio?.closedTrades.length === 0 && (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">📋</p>
                <p className="text-xs" style={{ color: "#4a6580" }}>Belum ada trade history</p>
              </div>
            )}
            {portfolio?.closedTrades.map((trade) => (
              <div
                key={trade.id}
                className="rounded-lg p-3 flex items-center justify-between"
                style={{
                  background: "#0d1117",
                  border: `1px solid ${trade.pnl >= 0 ? "#00ff4422" : "#ff444422"}`,
                }}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs px-1.5 rounded font-bold"
                      style={{
                        background: trade.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: trade.type === "LONG" ? "#00ff88" : "#ff4444",
                      }}
                    >
                      {trade.type}
                    </span>
                    <span className="text-xs font-bold">{trade.coin}</span>
                    <span
                      className="text-xs px-1.5 rounded"
                      style={{
                        background: trade.closeReason === "SL" ? "#2d0d0d" : "#0d2d1a",
                        color: trade.closeReason === "SL" ? "#ff4444" : "#00ff88",
                      }}
                    >
                      {trade.closeReason}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "#4a6580" }}>
                    ${trade.entryPrice.toFixed(4)} → ${trade.currentPrice.toFixed(4)}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className="text-sm font-bold"
                    style={{ color: trade.pnl >= 0 ? "#00ff88" : "#ff4444" }}
                  >
                    {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(2)}
                  </p>
                  <p className="text-xs" style={{ color: "#4a6580" }}>
                    {trade.pnlPercent.toFixed(2)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Chart Tab */}
        {activeTab === "chart" && (
          <div>
            <div
              className="rounded-xl p-4 mb-4"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}
            >
              <p className="text-xs mb-3" style={{ color: "#4a6580" }}>Portfolio Value Over Time</p>
              {renderChart()}
              <div className="flex justify-between mt-2 text-xs" style={{ color: "#4a6580" }}>
                <span>Start: $1000</span>
                <span>Now: ${totalValue.toFixed(2)}</span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Trades", value: portfolio?.totalTrades || 0, color: "#00d4ff" },
                { label: "Win Rate", value: `${portfolio?.winRate.toFixed(0) || 0}%`, color: "#00ff88" },
                { label: "Wins", value: portfolio?.wins || 0, color: "#00ff88" },
                { label: "Losses", value: portfolio?.losses || 0, color: "#ff4444" },
                { label: "Total PnL", value: `$${totalPnl.toFixed(2)}`, color: isProfitable ? "#00ff88" : "#ff4444" },
                { label: "Return", value: `${totalPnlPct}%`, color: isProfitable ? "#00ff88" : "#ff4444" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg p-3 text-center"
                  style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}
                >
                  <p className="text-xs mb-1" style={{ color: "#4a6580" }}>{stat.label}</p>
                  <p className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
