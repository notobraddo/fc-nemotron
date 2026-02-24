import { NextRequest, NextResponse } from "next/server";
import { startBot, stopBot, getBotStatus } from "@/lib/worker/manager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") || "default";
  const status = getBotStatus(userId);
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const { userId, action } = await req.json();

  if (action === "start") {
    const result = startBot(userId);
    return NextResponse.json(result);
  }

  if (action === "stop") {
    const result = stopBot(userId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
