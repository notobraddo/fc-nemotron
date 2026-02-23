export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  content: string;
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "deepseek-ai/deepseek-r1-distill-qwen-14b";

export async function callNvidiaAgent(
  messages: Message[],
  systemPrompt?: string
): Promise<AgentResponse> {
  const allMessages: Message[] = [];

  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  allMessages.push(...messages);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: allMessages,
        temperature: 0.6,
        top_p: 0.7,
        max_tokens: 1024,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`NVIDIA API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content || "";
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    return { content };
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      throw new Error("Timeout — coba lagi");
    }
    throw error;
  }
}
