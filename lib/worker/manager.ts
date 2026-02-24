import path from "path";

// Pakai dynamic import untuk Worker agar tidak crash di edge runtime
let Worker: any;
try {
  const wt = require("worker_threads");
  Worker = wt.Worker;
} catch {
  Worker = null;
}

interface BotState {
  worker: any;
  userId: string;
  logs: string[];
  isRunning: boolean;
  startTime: Date;
  cycleCount: number;
}

const bots = new Map<string, BotState>();

export function startBot(userId: string): { success: boolean; message: string } {
  if (!Worker) {
    return { success: false, message: "Worker threads tidak tersedia di environment ini" };
  }

  if (bots.has(userId)) {
    return { success: false, message: "Bot sudah berjalan" };
  }

  try {
    // Pakai compiled JS file, bukan TS langsung
    const workerPath = path.join(process.cwd(), "lib/worker/trading-bot.js");

    const worker = new Worker(workerPath, { workerData: { userId } });

    const state: BotState = {
      worker,
      userId,
      logs: [`[${new Date().toLocaleTimeString()}] 🚀 Bot started for ${userId}`],
      isRunning: true,
      startTime: new Date(),
      cycleCount: 0,
    };

    worker.on("message", (msg: any) => {
      if (msg.type === "logs") {
        state.logs.push(...msg.logs);
        state.cycleCount++;
        if (state.logs.length > 200) state.logs = state.logs.slice(-200);
      }
      if (msg.type === "error") {
        state.logs.push(`❌ ${msg.message}`);
      }
    });

    worker.on("error", (err: Error) => {
      state.logs.push(`❌ Worker error: ${err.message}`);
      state.isRunning = false;
      bots.delete(userId);
    });

    worker.on("exit", (code: number) => {
      state.isRunning = false;
      if (code !== 0) state.logs.push(`⚠️ Worker exit code: ${code}`);
      bots.delete(userId);
    });

    bots.set(userId, state);
    return { success: true, message: "Bot started! Cycle setiap 5 menit" };
  } catch (err: any) {
    return { success: false, message: `Failed: ${err.message}` };
  }
}

export function stopBot(userId: string): { success: boolean; message: string } {
  const state = bots.get(userId);
  if (!state) return { success: false, message: "Bot tidak ditemukan" };
  try {
    state.worker.terminate();
  } catch {}
  bots.delete(userId);
  return { success: true, message: "Bot dihentikan" };
}

export function getBotStatus(userId: string) {
  const state = bots.get(userId);
  if (!state) return { isRunning: false, logs: [], cycleCount: 0, uptime: "0 menit" };

  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 60000);
  return {
    isRunning: state.isRunning,
    logs: state.logs.slice(-100),
    cycleCount: state.cycleCount,
    uptime: `${uptime} menit`,
  };
}
