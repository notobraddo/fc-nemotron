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

interface BotStatus {
  isRunning: boolean;
  logs: string[];
  cycleCount: number;
  uptime?: string;
}

export default function PaperTrading() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus>({ isRunning: false, logs: [], cycleCount: 0 });
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"positions" | "history" | "chart" | "logs">("positions");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        const uid = context?.user?.fid?.toString() || "browser-" + Math.random().toString(36).substr(2, 9);
        setUserId(uid);
        fetchAll(uid);
      } catch {
        const uid = "browser-" + Math.random().toString(36).substr(2, 9);
        setUserId(uid);
        fetchAll(uid);
      }
    };
    init();
  }, []);

  // Poll setiap 15 detik
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => fetchAll(userId), 15000);
    return () => clearInterval(interval);
  }, [userId]);

  // Auto scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [botStatus.logs]);

  const fetchAll = async (uid: string) => {
    await Promise.all([fetchPortfolio(uid), fetchBotStatus(uid)]);
    setLastUpdate(new Date());
  };

  const fetchPortfolio = async (uid: string) => {
    try {
      const res = await fetch(`/api/paper-trading?userId=${uid}`);
      const data = await res.json();
      setPortfolio(data.portfolio);
    } catch {}
  };

  const fetchBotStatus = async (uid: string) => {
    try {
      const res = await fetch(`/api/bot?userId=${uid}`);
      const data = await res.json();
      setBotStatus(data);
    } catch {}
  };

  const toggleBot = async () => {
    const action = botStatus.isRunning ? "stop" : "start";
    await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    await fetchBotStatus(userId);
  };

  const handleReset = async () => {
    if (!confirm("Reset portfolio ke $1000? Bot akan dihentikan.")) return;
    if (botStatus.isRunning) {
      await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "stop" }),
      });
    }
    await fetch("/api/paper-trading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "reset" }),
    });
    await fetchAll(userId);
  };

  const totalValue = portfolio
    ? portfolio.balance + portfolio.positions.reduce((s, p) => s + p.size + p.pnl, 0)
    : 1000;
  const totalPnl = portfolio ? totalValue - portfolio.initialBalance : 0;
  const totalPnlPct = ((totalPnl / (portfolio?.initialBalance || 1000)) * 100).toFixed(2);
  const isProfitable = totalPnl >= 0;

  const renderChart = () => {
    if (!portfolio?.pnlHistory || portfolio.pnlHistory.length < 2) {
      return (
        <div className="flex items-center justify-center h-32 text-xs" style={{ color: "#4a6580" }}>
          Belum ada data. Jalankan bot dulu!
        </div>
      );
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
            <a href="/" className="text-xs px-2 py-1 rounded" style={{ background: "#1a1f2e", color: "#4a6580" }}>← Back</a>
            <div>
              <h1 className="text-sm font-bold" style={{ color: "#00d4ff" }}>📊 Paper Trading</h1>
              <p className="text-xs" style={{ color: "#4a6580" }}>
                {botStatus.isRunning
                  ? `🟢 Bot Running · Cycle ${botStatus.cycleCount} · ${botStatus.uptime}`
                  : "⭕ Bot Stopped"}
              </p>
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
          <div className="flex justify-between items-center">
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
          <div className="flex gap-4 mt-2 pt-2" style={{ borderTop: "1px solid #1e2d3d" }}>
            <span className="text-xs"><span style={{ color: "#4a6580" }}>Cash: </span>
              <span>${portfolio?.balance.toFixed(2) || "1000.00"}</span></span>
            <span className="text-xs"><span style={{ color: "#4a6580" }}>WR: </span>
              <span style={{ color: "#00ff88" }}>{portfolio?.winRate.toFixed(0) || 0}%</span></span>
            <span className="text-xs"><span style={{ color: "#4a6580" }}>Trades: </span>
              <span>{portfolio?.totalTrades || 0}</span></span>
          </div>
        </div>

        {/* Bot Toggle */}
        <button onClick={toggleBot}
          className="w-full py-3 rounded-xl text-sm font-bold transition-all"
          style={{
            background: botStatus.isRunning
              ? "linear-gradient(135deg, #ff4444, #cc0000)"
              : "linear-gradient(135deg, #00d4ff, #0066ff)",
            color: "#fff", border: "none", letterSpacing: "0.05em",
          }}>
          {botStatus.isRunning
            ? "⏹ Stop Background Bot"
            : "▶ Start Background Bot (tiap 5 menit)"}
        </button>
        {lastUpdate && (
          <p className="text-center text-xs mt-1" style={{ color: "#4a6580" }}>
            Last update: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid #1e2d3d" }}>
        {(["positions", "history", "chart", "logs"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 text-xs capitalize"
            style={{
              background: activeTab === tab ? "#0d1117" : "transparent",
              color: activeTab === tab ? "#00d4ff" : "#4a6580",
              borderBottom: activeTab === tab ? "2px solid #00d4ff" : "2px solid transparent",
            }}>
            {tab === "positions" ? `Open (${portfolio?.positions.length || 0})`
              : tab === "history" ? `History (${portfolio?.closedTrades.length || 0})`
              : tab === "logs" ? `Logs (${botStatus.cycleCount})`
              : "Chart"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">

        {/* Positions */}
        {activeTab === "positions" && (
          <div className="space-y-3">
            {!portfolio?.positions.length && (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">🤖</p>
                <p className="text-xs" style={{ color: "#4a6580" }}>
                  Start bot untuk mulai auto trading di background
                </p>
              </div>
            )}
            {portfolio?.positions.map((pos) => (
              <div key={pos.id} className="rounded-xl p-3"
                style={{ background: "#0d1117", border: `1px solid ${pos.pnl >= 0 ? "#00ff4433" : "#ff444433"}` }}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-bold"
                      style={{ background: pos.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: pos.type === "LONG" ? "#00ff88" : "#ff4444" }}>
                      {pos.type}
                    </span>
                    <span className="text-sm font-bold">{pos.coin}</span>
                  </div>
                  <span className="text-sm font-bold"
                    style={{ color: pos.pnl >= 0 ? "#00ff88" : "#ff4444" }}>
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

        {/* History */}
        {activeTab === "history" && (
          <div className="space-y-2">
            {!portfolio?.closedTrades.length && (
              <div className="text-center py-8">
                <p className="text-xs" style={{ color: "#4a6580" }}>Belum ada trade history</p>
              </div>
            )}
            {portfolio?.closedTrades.map((trade) => (
              <div key={trade.id} className="rounded-lg p-3 flex items-center justify-between"
                style={{ background: "#0d1117", border: `1px solid ${trade.pnl >= 0 ? "#00ff4422" : "#ff444422"}` }}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 rounded font-bold"
                      style={{ background: trade.type === "LONG" ? "#0d2d1a" : "#2d0d0d",
                        color: trade.type === "LONG" ? "#00ff88" : "#ff4444" }}>
                      {trade.type}
                    </span>
                    <span className="text-xs font-bold">{trade.coin}</span>
                    <span className="text-xs px-1.5 rounded"
                      style={{ background: trade.closeReason === "SL" ? "#2d0d0d" : "#0d2d1a",
                        color: trade.closeReason === "SL" ? "#ff4444" : "#00ff88" }}>
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
          </div>
        )}

        {/* Chart */}
        {activeTab === "chart" && (
          <div>
            <div className="rounded-xl p-4 mb-4"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}>
              <p className="text-xs mb-3" style={{ color: "#4a6580" }}>Portfolio Value</p>
              {renderChart()}
              <div className="flex justify-between mt-2 text-xs" style={{ color: "#4a6580" }}>
                <span>Start: $1000</span>
                <span style={{ color: isProfitable ? "#00ff88" : "#ff4444" }}>Now: ${totalValue.toFixed(2)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Trades", value: portfolio?.totalTrades || 0, color: "#00d4ff" },
                { label: "Win Rate", value: `${portfolio?.winRate.toFixed(0) || 0}%`, color: "#00ff88" },
                { label: "Wins", value: portfolio?.wins || 0, color: "#00ff88" },
                { label: "Losses", value: portfolio?.losses || 0, color: "#ff4444" },
                { label: "Total PnL", value: `$${totalPnl.toFixed(2)}`, color: isProfitable ? "#00ff88" : "#ff4444" },
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

        {/* Bot Logs */}
        {activeTab === "logs" && (
          <div>
            <div className="rounded-xl p-3"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d", minHeight: "300px" }}>
              {botStatus.logs.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: "#4a6580" }}>
                  Start bot untuk melihat logs
                </p>
              ) : (
                <div className="space-y-1">
                  {botStatus.logs.map((log, i) => (
                    <p key={i} className="text-xs leading-relaxed"
                      style={{
                        color: log.includes("✅") || log.includes("🟢") ? "#00ff88"
                          : log.includes("❌") || log.includes("🔴") ? "#ff4444"
                          : log.includes("⚠️") ? "#ffaa00"
                          : "#4a6580",
                        fontFamily: "monospace",
                      }}>
                      {log}
                    </p>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
