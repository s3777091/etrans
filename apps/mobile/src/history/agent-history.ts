import type { AgentChatMessage, AgentSource } from "../agent/agent-client";

export const MAX_AGENT_HISTORY_MESSAGES = 80;

export function parseAgentHistory(
  value: string | null | undefined,
): AgentChatMessage[] {
  if (!value) return [];
  try {
    const candidate = JSON.parse(value) as unknown;
    if (!Array.isArray(candidate)) return [];
    return candidate
      .map((item) => sanitizeMessage(item))
      .filter((item): item is AgentChatMessage => Boolean(item))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_AGENT_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

export function serializeAgentHistory(messages: AgentChatMessage[]): string {
  const compact = messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      text:
        message.text.trim() ||
        (message.imageDataUrl || message.imageUri ? "[Ảnh]" : ""),
      sources: message.sources,
      status: message.status === "error" ? "error" : "done",
      createdAt: message.createdAt,
    }))
    .map((item) => sanitizeMessage(item))
    .filter((item): item is AgentChatMessage => Boolean(item))
    .slice(-MAX_AGENT_HISTORY_MESSAGES);
  return JSON.stringify(compact);
}

function sanitizeMessage(value: unknown): AgentChatMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<AgentChatMessage>;
  if (
    typeof item.id !== "string" ||
    (item.role !== "user" && item.role !== "assistant") ||
    typeof item.text !== "string" ||
    !Number.isFinite(item.createdAt)
  ) {
    return undefined;
  }
  const text = item.text.trim().slice(0, 8_000);
  if (!text) return undefined;
  return {
    id: item.id.slice(0, 120),
    role: item.role,
    text,
    sources: sanitizeSources(item.sources),
    status: item.status === "error" ? "error" : "done",
    createdAt: item.createdAt as number,
  };
}

function sanitizeSources(value: unknown): AgentSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is AgentSource =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as AgentSource).title === "string" &&
        typeof (item as AgentSource).url === "string",
    )
    .slice(0, 8)
    .map((source) => ({
      title: source.title.slice(0, 200),
      url: source.url.slice(0, 2_000),
    }));
}
