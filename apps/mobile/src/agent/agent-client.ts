import type { AgentSettings } from "../settings/agent-settings";

const CONNECT_TIMEOUT_MS = 8_000;
/** Older photos stay as a text marker so a long chat keeps a small payload. */
const IMAGE_HISTORY_DEPTH = 2;
const MAX_HISTORY_MESSAGES = 20;

export interface AgentSource {
  title: string;
  url: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Local file URI kept only for rendering the bubble. */
  imageUri?: string;
  /** Compressed JPEG data URL sent to the server. */
  imageDataUrl?: string;
  reasoning?: string;
  sources?: AgentSource[];
  searches?: string[];
  status?: "streaming" | "done" | "error";
  createdAt: number;
}

/**
 * Every event carries the id of the turn that produced it. Interrupting an
 * answer leaves its late events in flight, and without the id they would be
 * appended to whatever the user asked next.
 */
export type AgentClientEvent = AgentEventBody & { turnId?: string };

type AgentEventBody =
  | { type: "agent.start" }
  | { type: "agent.reasoning"; text: string }
  | { type: "agent.delta"; text: string }
  | {
      type: "agent.tool";
      status: "start" | "done" | "failed";
      name: string;
      query: string;
      sources?: readonly AgentSource[];
      message?: string;
    }
  | { type: "agent.done"; text: string; sources: readonly AgentSource[] }
  | { type: "agent.error"; code: string; message: string };

interface WireTextPart {
  type: "text";
  text: string;
}

interface WireImagePart {
  type: "image_url";
  image_url: { url: string };
}

export interface WireMessage {
  role: "user" | "assistant";
  content: string | Array<WireTextPart | WireImagePart>;
}

export function buildAgentSocketUrl(apiBaseUrl: string): string {
  const url = new URL(
    "/v1/agent/chat",
    apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function buildTurnPayload(
  messages: AgentChatMessage[],
  settings: AgentSettings,
  turnId?: string,
): Record<string, unknown> {
  return {
    type: "agent.turn",
    ...(turnId ? { turnId } : {}),
    model: settings.model,
    language: settings.language,
    reasoning: settings.reasoning,
    search: settings.search,
    prompt: settings.prompt.trim(),
    messages: toWireMessages(messages),
  };
}

export function toWireMessages(
  messages: AgentChatMessage[],
): WireMessage[] {
  const usable = messages
    .filter((message) => message.status !== "error")
    .filter((message) => message.text.trim() || message.imageDataUrl)
    .slice(-MAX_HISTORY_MESSAGES);
  const imageCutoff = usable.length - IMAGE_HISTORY_DEPTH;

  return usable.map((message, index) => {
    const text = message.text.trim();
    if (!message.imageDataUrl) {
      return { role: message.role, content: text };
    }
    if (index < imageCutoff) {
      return {
        role: message.role,
        content: text ? `[ảnh đã gửi] ${text}` : "[ảnh đã gửi]",
      };
    }
    const parts: Array<WireTextPart | WireImagePart> = [
      { type: "image_url", image_url: { url: message.imageDataUrl } },
    ];
    if (text) parts.unshift({ type: "text", text });
    return { role: message.role, content: parts };
  });
}

export function parseAgentEvent(data: unknown): AgentClientEvent | undefined {
  if (typeof data !== "string") return undefined;
  try {
    const parsed = JSON.parse(data) as { type?: string };
    switch (parsed.type) {
      case "agent.start":
      case "agent.reasoning":
      case "agent.delta":
      case "agent.tool":
      case "agent.done":
      case "agent.error":
        return parsed as AgentClientEvent;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export class AgentChatClient {
  private socket: WebSocket | undefined;
  private connecting: Promise<WebSocket> | undefined;
  private readonly listeners = new Set<(event: AgentClientEvent) => void>();
  private disposed = false;
  /** A turn with no terminal event yet; a dropped socket has to end it. */
  private turnActive = false;
  private turnId: string | undefined;

  constructor(private readonly apiBaseUrl: string) {}

  onEvent(listener: (event: AgentClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(
    messages: AgentChatMessage[],
    settings: AgentSettings,
    turnId?: string,
  ): Promise<void> {
    this.turnActive = true;
    this.turnId = turnId;
    try {
      const socket = await this.connect();
      socket.send(JSON.stringify(buildTurnPayload(messages, settings, turnId)));
    } catch {
      this.emit({
        type: "agent.error",
        code: "NETWORK_ERROR",
        message: "Không thể kết nối máy chủ trợ lý",
        turnId,
      });
    }
  }

  cancel(): void {
    this.turnActive = false;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "agent.cancel" }));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    const socket = this.socket;
    this.socket = undefined;
    if (
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, "Client disposed");
    }
  }

  private connect(): Promise<WebSocket> {
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const next = new WebSocket(buildAgentSocketUrl(this.apiBaseUrl));
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        next.close();
        reject(new Error("Agent connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      next.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.socket = next;
        resolve(next);
      };
      next.onmessage = (event) => {
        const parsed = parseAgentEvent(event.data);
        if (parsed) this.emit(parsed);
      };
      next.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Agent connection failed"));
      };
      next.onclose = () => {
        clearTimeout(timeout);
        if (this.socket === next) this.socket = undefined;
        if (!settled) {
          settled = true;
          reject(new Error("Agent connection closed"));
          return;
        }
        // Without this the UI would wait forever for a reply that the dropped
        // socket can no longer deliver.
        if (this.turnActive) {
          this.emit({
            type: "agent.error",
            code: "CONNECTION_CLOSED",
            message: "Mất kết nối tới máy chủ trợ lý",
            turnId: this.turnId,
          });
        }
      };
    }).finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  private emit(event: AgentClientEvent): void {
    if (event.type === "agent.done" || event.type === "agent.error") {
      this.turnActive = false;
    }
    if (this.disposed) return;
    this.listeners.forEach((listener) => listener(event));
  }
}
