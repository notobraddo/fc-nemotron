import { Worker } from "worker_threads";
import path from "path";

interface BotState {
  worker: Worker;
  userId: string;
  logs: string[];
  isRunning: boolean;
  startTime: Date;
  cycleCount: number;
}

// Global bot registry
const bots = new Map<string, BotState>();

export function startBot(userId: string): { success: boolean; message: string } {
  if (bots.has(userId)) {
    return { success: false, message: "Bot sudah berjalan untuk user ini" };
  }

  try {
    const worker = new Worker(
      path.join(process.cwd(), "lib/worker/trading-bot.ts"),
      {
        workerData: { userId },
        execArgv: ["--require", "ts-node/register"], // support TypeScript
      }
    );

    const state: BotState = {
      worker,
      userId,
      logs: [],
      isRunning: true,
      startTime: new Date(),
      cycleCount: 0,
    };

    worker.on("message", (msg) => {
      if (msg.type === "logs") {
        state.logs.push(...msg.logs);
        state.cycleCount++;
        // Keep only last 100 logs
        if (state.logs.length > 100) {
          state.logs = state.logs.slice(-100);
        }
      }
      if (msg.type === "started") {
        state.logs.push(`✅ ${msg.message}`);
      }
      if (msg.type === "error") {
        state.logs.push(`❌ Error: ${msg.message}`);
      }
    });

    worker.on("error", (err) => {
      state.logs.push(`❌ Worker error: ${err.message}`);
      state.isRunning = false;
    });

    worker.on("exit", (code) => {
      state.isRunning = false;
      state.logs.push(`⚠️ Worker exited with code ${code}`);
      bots.delete(userId);
    });

    bots.set(userId, state);
    return { success: true, message: "Bot started! Trading setiap 5 menit" };
  } catch (err: any) {
    return { success: false, message: `Failed to start bot: ${err.message}` };
  }
}

export function stopBot(userId: string): { success: boolean; message: string } {
  const state = bots.get(userId);
  if (!state) {
    return { success: false, message: "Bot tidak ditemukan" };
  }

  state.worker.terminate();
  bots.delete(userId);
  return { success: true, message: "Bot dihentikan" };
}

export function getBotStatus(userId: string): {
  isRunning: boolean;
  logs: string[];
  cycleCount: number;
  uptime?: string;
} {
  const state = bots.get(userId);
  if (!state) {
    return { isRunning: false, logs: [], cycleCount: 0 };
  }

  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000 / 60);

  return {
    isRunning: state.isRunning,
    logs: state.logs.slice(-50), // Return last 50 logs
    cycleCount: state.cycleCount,
    uptime: `${uptime} menit`,
  };
}

export function isRunning(userId: string): boolean {
  return bots.has(userId);
}
