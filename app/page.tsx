"use client";

import { useState, useEffect, useRef } from "react";
import sdk from "@farcaster/frame-sdk";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolUsed?: string | null;
  timestamp?: Date;
}

const TOOL_BADGES: Record<string, { label: string; color: string }> = {
  technical: { label: "📊 Live TA", color: "bg-emerald-900 text-emerald-300 border border-emerald-700" },
  screener:  { label: "🔍 Screener", color: "bg-blue-900 text-blue-300 border border-blue-700" },
  price:     { label: "💵 Live Price", color: "bg-yellow-900 text-yellow-300 border border-yellow-700" },
  trending:  { label: "🔥 Trending", color: "bg-orange-900 text-orange-300 border border-orange-700" },
  market:    { label: "📈 Market", color: "bg-purple-900 text-purple-300 border border-purple-700" },
  search:    { label: "🌐 Web", color: "bg-gray-700 text-gray-300 border border-gray-600" },
};

const QUICK_PROMPTS = [
  { label: "📊 Analisis BTC", prompt: "Analisis teknikal BTC lengkap dengan entry, SL, dan TP" },
  { label: "📊 Analisis ETH", prompt: "Analisis teknikal ETH dengan SMC dan RSI" },
  { label: "🔍 Screen Gainers", prompt: "Screen token yang naik lebih dari 3% hari ini" },
  { label: "🔍 High Volume", prompt: "Cari token dengan volume tinggi hari ini" },
  { label: "📈 Long BTC", prompt: "Carikan area entry long BTC dengan risk management" },
  { label: "📉 Short ETH", prompt: "Setup short ETH berdasarkan SMC dan RSI" },
  { label: "🔥 Trending", prompt: "Coin apa yang trending sekarang?" },
  { label: "🎯 SOL Setup", prompt: "Berikan trading setup SOL hari ini" },
];

export default function TradingAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [loadingText, setLoadingText] = useState("Analyzing...");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadingTexts = [
    "Fetching live data...",
    "Running SMC analysis...",
    "Calculating RSI...",
    "Checking order blocks...",
    "Finding entry zones...",
    "Computing risk/reward...",
  ];

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        setUserId(context?.user?.fid?.toString() || "browser-" + Math.random().toString(36).substr(2, 9));
        await sdk.actions.ready();
      } catch {
        setUserId("browser-" + Math.random().toString(36).substr(2, 9));
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!isLoading) return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % loadingTexts.length;
      setLoadingText(loadingTexts[i]);
    }, 1500);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    setInput("");
    setMessages((p) => [...p, { role: "user", content: msg, timestamp: new Date() }]);
    setIsLoading(true);
    setLoadingText("Fetching live data...");

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: msg, userId }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages((p) => [...p, {
          role: "assistant",
          content: `❌ Error: ${data.error}`,
        }]);
      } else {
        setMessages((p) => [...p, {
          role: "assistant",
          content: data.response,
          toolUsed: data.toolUsed,
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages((p) => [...p, {
        role: "assistant",
        content: "❌ Koneksi gagal. Coba lagi.",
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    await fetch("/api/agent", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setMessages([]);
  };

  return (
    <div
      className="flex flex-col h-screen max-w-md mx-auto"
      style={{ background: "#080b12", color: "#e2e8f0", fontFamily: "'DM Mono', 'Fira Code', monospace" }}
    >
      {/* Header */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #1e2d3d" }} className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div
              className="flex items-center justify-center w-9 h-9 rounded-lg text-lg"
              style={{ background: "linear-gradient(135deg, #00d4ff, #0066ff)", fontWeight: 900 }}
            >
              TA
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm" style={{ color: "#00d4ff", letterSpacing: "0.05em" }}>
                  FC_AGENT
                </h1>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "#0d2d1a", color: "#00ff88", border: "1px solid #00ff4433", fontSize: "10px" }}
                >
                  ● LIVE
                </span>
              </div>
              <p className="text-xs" style={{ color: "#4a6580" }}>
                DeepSeek R1 · SMC · RSI · MA · Screener
              </p>
            </div>
          </div>
          <button
            onClick={clearChat}
            className="text-xs px-3 py-1 rounded"
            style={{ background: "#1a1f2e", color: "#4a6580", border: "1px solid #1e2d3d" }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="py-4">
            {/* Welcome */}
            <div
              className="rounded-xl p-4 mb-4 text-center"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}
            >
              <div className="text-2xl mb-2">📊</div>
              <p className="text-sm font-bold mb-1" style={{ color: "#00d4ff" }}>
                FC_Agent
              </p>
              <p className="text-xs" style={{ color: "#4a6580" }}>
                Analisis teknikal real-time · Token screening · Trade setup
              </p>
            </div>

            {/* Quick Prompts */}
            <p className="text-xs mb-2 px-1" style={{ color: "#4a6580" }}>Quick actions:</p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.prompt}
                  onClick={() => sendMessage(q.prompt)}
                  className="text-left text-xs p-3 rounded-lg transition-all"
                  style={{
                    background: "#0d1117",
                    border: "1px solid #1e2d3d",
                    color: "#8899aa",
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.borderColor = "#00d4ff44";
                    (e.target as HTMLElement).style.color = "#e2e8f0";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.borderColor = "#1e2d3d";
                    (e.target as HTMLElement).style.color = "#8899aa";
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-xs mr-2 flex-shrink-0 mt-1"
                style={{ background: "linear-gradient(135deg, #00d4ff, #0066ff)", fontWeight: 900, fontSize: "9px" }}
              >
                TA
              </div>
            )}
            <div style={{ maxWidth: "85%" }}>
              {/* Tool badge */}
              {msg.role === "assistant" && msg.toolUsed && TOOL_BADGES[msg.toolUsed] && (
                <div className="mb-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${TOOL_BADGES[msg.toolUsed].color}`}
                    style={{ fontSize: "10px" }}
                  >
                    {TOOL_BADGES[msg.toolUsed].label}
                  </span>
                </div>
              )}
              <div
                className="rounded-xl px-4 py-3 text-xs"
                style={
                  msg.role === "user"
                    ? {
                        background: "#0d2040",
                        border: "1px solid #0066ff44",
                        color: "#e2e8f0",
                        borderBottomRightRadius: "4px",
                      }
                    : {
                        background: "#0d1117",
                        border: "1px solid #1e2d3d",
                        color: "#c8d8e8",
                        borderBottomLeftRadius: "4px",
                      }
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start items-start">
            <div
              className="w-6 h-6 rounded flex items-center justify-center text-xs mr-2 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #00d4ff, #0066ff)", fontWeight: 900, fontSize: "9px" }}
            >
              TA
            </div>
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: "#0d1117", border: "1px solid #1e2d3d" }}
            >
              <p className="text-xs mb-2" style={{ color: "#00d4ff" }}>
                {loadingText}
              </p>
              <div className="flex space-x-1">
                {[0, 0.15, 0.3].map((delay, i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: "#00d4ff", animationDelay: `${delay}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ background: "#0d1117", borderTop: "1px solid #1e2d3d" }} className="p-3">
        {/* Hint chips */}
        {messages.length > 0 && !isLoading && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {["Entry long BTC", "Screen gainers", "RSI ETH", "TP SOL"].map((hint) => (
              <button
                key={hint}
                onClick={() => setInput(hint)}
                className="flex-shrink-0 text-xs px-3 py-1 rounded-full"
                style={{ background: "#1a1f2e", color: "#4a6580", border: "1px solid #1e2d3d", fontSize: "11px" }}
              >
                {hint}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Analisis BTC, screen token, cari entry..."
            rows={1}
            className="flex-1 text-xs rounded-lg px-3 py-2.5 resize-none focus:outline-none"
            style={{
              background: "#1a1f2e",
              border: "1px solid #1e2d3d",
              color: "#e2e8f0",
              caretColor: "#00d4ff",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#00d4ff44")}
            onBlur={(e) => (e.target.style.borderColor = "#1e2d3d")}
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: isLoading || !input.trim()
                ? "#1a1f2e"
                : "linear-gradient(135deg, #00d4ff, #0066ff)",
              color: isLoading || !input.trim() ? "#4a6580" : "#fff",
              border: "none",
              letterSpacing: "0.05em",
            }}
          >
            {isLoading ? "..." : "SEND"}
          </button>
        </div>
      </div>
    </div>
  );
}
