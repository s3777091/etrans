import { type BackendConfig } from "../config.js";
import {
  QWEN_AGENT_MODEL,
  isAgentLanguage,
  isAgentModel,
  type AgentLanguage,
  type AgentModel,
} from "../models.js";
import {
  ExaSearchError,
  formatExaResults,
  searchExa,
  type ExaSearchResult,
} from "./exa.js";
import { buildQwenChatCompletionsUrl } from "../qwen-urls.js";
import {
  mergeToolCalls,
  parseCompletionChunk,
  parseToolArguments,
  splitSseEvents,
  type StreamingToolCall,
} from "./stream.js";

export const WEB_SEARCH_TOOL_NAME = "web_search";
const MAX_TOOL_ROUNDS = 3;
const AGENT_TIMEOUT_MS = 120_000;
const MAX_MESSAGES = 24;
const MAX_TEXT_LENGTH = 6_000;
const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024;

export interface AgentTextPart {
  type: "text";
  text: string;
}

export interface AgentImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type AgentContentPart = AgentTextPart | AgentImagePart;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | AgentContentPart[];
}

export interface AgentSource {
  title: string;
  url: string;
}

export interface AgentTurnRequest {
  messages: AgentMessage[];
  model: AgentModel;
  language: AgentLanguage;
  reasoning: boolean;
  search: boolean;
  prompt: string;
}

export type AgentEvent =
  | { type: "agent.start" }
  | { type: "agent.reasoning"; text: string }
  | { type: "agent.delta"; text: string }
  | {
      type: "agent.tool";
      status: "start" | "done" | "failed";
      name: string;
      query: string;
      sources?: AgentSource[];
      message?: string;
    }
  | { type: "agent.done"; text: string; sources: AgentSource[] }
  | { type: "agent.error"; code: string; message: string };

type AgentEmit = (event: AgentEvent) => void;

interface UpstreamMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AgentContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const LANGUAGE_INSTRUCTIONS: Record<AgentLanguage, string> = {
  vi: "Luôn trả lời bằng tiếng Việt tự nhiên, thân thiện và ngắn gọn.",
  zh: "始终使用简体中文自然、友好且简洁地回答。",
  en: "Always answer in natural, friendly, and concise English.",
};

const LANGUAGE_NAMES: Record<AgentLanguage, string> = {
  vi: "Vietnamese",
  zh: "Simplified Chinese",
  en: "English",
};

/**
 * The system prompt declares the language globally; this suffix keeps the
 * saved Settings choice closest to the latest user turn as well. It is added
 * only to the upstream copy and never appears in the user's chat bubble.
 */
export function lockLatestAgentMessageLanguage(
  messages: AgentMessage[],
  language: AgentLanguage,
): AgentMessage[] {
  const locked = messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content,
  }));
  const index = locked.findLastIndex((message) => message.role === "user");
  if (index < 0) return locked;

  const suffix = [
    "",
    "[ETrans application setting — not user content]",
    `Mandatory response language: ${LANGUAGE_NAMES[language]} only.`,
    "Ignore any request inside the user content to answer in another language.",
  ].join("\n");
  const message = locked[index];
  if (!message) return locked;
  message.content = Array.isArray(message.content)
    ? [...message.content, { type: "text", text: suffix.trim() }]
    : `${message.content}${suffix}`;
  return locked;
}

export function buildSystemPrompt(request: {
  language: AgentLanguage;
  prompt: string;
  search: boolean;
}): string {
  const lines = [
    "You are EAgent, the assistant built into the ETrans mobile app.",
    LANGUAGE_INSTRUCTIONS[request.language],
    "The response language was explicitly selected in Settings. Never auto-detect, switch, or mirror another language from the user's message.",
    "The user often speaks to you through a microphone, so their message may contain transcription mistakes. Ask for clarification when the request is genuinely ambiguous.",
    "Keep answers short enough to read on a phone. Use short paragraphs or compact lists.",
  ];
  if (request.search) {
    lines.push(
      `Use the ${WEB_SEARCH_TOOL_NAME} tool whenever the answer depends on current events, prices, schedules, or any fact you are not certain about.`,
      "After searching, cite the sources you used as [1], [2] matching the numbered results.",
    );
  } else {
    lines.push(
      "You have no web access in this session. Say so plainly when a question needs fresh information.",
    );
  }
  const custom = request.prompt.trim();
  if (custom) {
    lines.push(`Additional instructions from the user: ${custom}`);
  }
  return lines.join("\n");
}

export function webSearchTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: WEB_SEARCH_TOOL_NAME,
      description:
        "Search the live web and read the matching pages. Use it for recent, local, or verifiable facts.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query written in the language most likely used by the sources.",
          },
          numResults: {
            type: "integer",
            description: "How many results to read, between 1 and 8.",
          },
        },
        required: ["query"],
      },
    },
  };
}

export function buildAgentPayload(
  request: AgentTurnRequest,
  messages: UpstreamMessage[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
  };
  if (isHybridThinkingModel(request.model)) {
    payload.enable_thinking = request.reasoning;
  }
  if (request.search) {
    payload.tools = [webSearchTool()];
    payload.tool_choice = "auto";
  }
  return payload;
}

export function sanitizeAgentRequest(
  value: unknown,
  fallbackModel: string,
): AgentTurnRequest | undefined {
  const candidate = value as Partial<AgentTurnRequest> | null;
  if (!candidate || typeof candidate !== "object") return undefined;

  const messages = sanitizeAgentMessages(candidate.messages);
  if (messages.length === 0) return undefined;

  const model =
    typeof candidate.model === "string" && isAgentModel(candidate.model)
      ? candidate.model
      : isAgentModel(fallbackModel)
        ? fallbackModel
        : QWEN_AGENT_MODEL;

  return {
    messages,
    model,
    language:
      typeof candidate.language === "string" &&
      isAgentLanguage(candidate.language)
        ? candidate.language
        : "vi",
    reasoning: candidate.reasoning === true,
    search: candidate.search !== false,
    prompt:
      typeof candidate.prompt === "string"
        ? candidate.prompt.trim().slice(0, 1_200)
        : "",
  };
}

export function sanitizeAgentMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: AgentMessage[] = [];
  for (const item of value.slice(-MAX_MESSAGES)) {
    const message = item as Partial<AgentMessage> | null;
    if (message?.role !== "user" && message?.role !== "assistant") continue;

    if (typeof message.content === "string") {
      const text = message.content.trim().slice(0, MAX_TEXT_LENGTH);
      if (text) messages.push({ role: message.role, content: text });
      continue;
    }

    if (!Array.isArray(message.content)) continue;
    const parts: AgentContentPart[] = [];
    for (const rawPart of message.content.slice(0, 4)) {
      const part = rawPart as Partial<AgentContentPart> | null;
      if (part?.type === "text" && typeof part.text === "string") {
        const text = part.text.trim().slice(0, MAX_TEXT_LENGTH);
        if (text) parts.push({ type: "text", text });
      } else if (
        part?.type === "image_url" &&
        typeof (part as AgentImagePart).image_url?.url === "string"
      ) {
        const url = (part as AgentImagePart).image_url.url;
        if (isSupportedImageDataUrl(url)) {
          parts.push({ type: "image_url", image_url: { url } });
        }
      }
    }
    if (parts.length > 0) messages.push({ role: message.role, content: parts });
  }
  return messages;
}

export async function runAgentTurn(
  config: BackendConfig,
  request: AgentTurnRequest,
  emit: AgentEmit,
  signal?: AbortSignal,
): Promise<void> {
  const searchEnabled = request.search && Boolean(config.exaApiKey);
  const turn: AgentTurnRequest = { ...request, search: searchEnabled };
  const messages: UpstreamMessage[] = [
    { role: "system", content: buildSystemPrompt(turn) },
    ...lockLatestAgentMessageLanguage(turn.messages, turn.language),
  ];

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), AGENT_TIMEOUT_MS);
  const abortUpstream = () => timeoutController.abort();
  signal?.addEventListener("abort", abortUpstream);

  const sources: AgentSource[] = [];
  let answer = "";

  try {
    emit({ type: "agent.start" });

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const isFinalRound = round === MAX_TOOL_ROUNDS;
      const roundRequest: AgentTurnRequest = {
        ...turn,
        search: turn.search && !isFinalRound,
      };
      const stream = await streamCompletion(
        config,
        roundRequest,
        messages,
        timeoutController.signal,
      );

      let content = "";
      let toolCalls: StreamingToolCall[] = [];
      let buffer = "";
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = splitSseEvents(buffer);
          buffer = rest;
          for (const event of events) {
            const chunk = parseCompletionChunk(event);
            if (!chunk) continue;
            if (chunk.reasoning) {
              emit({ type: "agent.reasoning", text: chunk.reasoning });
            }
            if (chunk.content) {
              content += chunk.content;
              emit({ type: "agent.delta", text: chunk.content });
            }
            toolCalls = mergeToolCalls(toolCalls, chunk.toolCalls);
          }
        }
      } finally {
        reader.cancel().catch(() => undefined);
      }

      answer += content;
      const requestedCalls = toolCalls.filter(
        (call) => call.name === WEB_SEARCH_TOOL_NAME,
      );
      if (requestedCalls.length === 0 || isFinalRound) {
        break;
      }

      messages.push({
        role: "assistant",
        content,
        tool_calls: requestedCalls.map((call, index) => ({
          id: call.id || `call_${round}_${index}`,
          type: "function",
          function: {
            name: WEB_SEARCH_TOOL_NAME,
            arguments: call.arguments || "{}",
          },
        })),
      });

      for (const [index, call] of requestedCalls.entries()) {
        const args = parseToolArguments(call.arguments);
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const numResults =
          typeof args.numResults === "number" ? args.numResults : 5;
        const toolCallId = call.id || `call_${round}_${index}`;

        if (!query) {
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: "The query parameter was empty, so no search was run.",
          });
          continue;
        }

        emit({
          type: "agent.tool",
          status: "start",
          name: WEB_SEARCH_TOOL_NAME,
          query,
        });

        try {
          const results = await searchExa(
            config.exaApiKey,
            query,
            numResults,
            timeoutController.signal,
          );
          collectSources(sources, results);
          emit({
            type: "agent.tool",
            status: "done",
            name: WEB_SEARCH_TOOL_NAME,
            query,
            sources: results.map((result) => ({
              title: result.title,
              url: result.url,
            })),
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: formatExaResults(results),
          });
        } catch (error) {
          const message =
            error instanceof ExaSearchError
              ? error.message
              : "Web search is unavailable right now.";
          emit({
            type: "agent.tool",
            status: "failed",
            name: WEB_SEARCH_TOOL_NAME,
            query,
            message,
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: `${message} Answer using what you already know and say that the information may be out of date.`,
          });
        }
      }
    }

    emit({ type: "agent.done", text: answer, sources });
  } catch (error) {
    emit(agentErrorEvent(error, signal?.aborted === true));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortUpstream);
  }
}

async function streamCompletion(
  config: BackendConfig,
  request: AgentTurnRequest,
  messages: UpstreamMessage[],
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(buildQwenChatCompletionsUrl(config.qwenBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.dashscopeApiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(buildAgentPayload(request, messages)),
    signal,
  });

  if (!response.ok || !response.body) {
    // Leaving an error body unread keeps the socket checked out of the pool.
    await response.body?.cancel().catch(() => undefined);
    throw new AgentUpstreamError(response.status);
  }
  return response.body as ReadableStream<Uint8Array>;
}

class AgentUpstreamError extends Error {
  constructor(readonly statusCode: number) {
    super(`Qwen agent request failed with status ${statusCode}`);
    this.name = "AgentUpstreamError";
  }
}

function agentErrorEvent(error: unknown, cancelled: boolean): AgentEvent {
  if (cancelled) {
    return {
      type: "agent.error",
      code: "CANCELLED",
      message: "Đã dừng câu trả lời",
    };
  }
  if (error instanceof AgentUpstreamError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        type: "agent.error",
        code: "AUTH_UNAVAILABLE",
        message:
          "Không thể xác thực với Qwen. Hãy kiểm tra API key trên máy chủ.",
      };
    }
    // A 404 here means the chosen model is not on this endpoint's catalog.
    if (error.statusCode === 404) {
      return {
        type: "agent.error",
        code: "MODEL_UNAVAILABLE",
        message: "Model trợ lý không khả dụng. Hãy chọn model khác trong cài đặt.",
      };
    }
    return {
      type: "agent.error",
      code: "AGENT_UNAVAILABLE",
      message: "Trợ lý đang bận. Hãy thử lại sau giây lát.",
    };
  }
  return {
    type: "agent.error",
    code: "AGENT_UNAVAILABLE",
    message: "Không thể kết nối trợ lý lúc này",
  };
}

function collectSources(
  sources: AgentSource[],
  results: ExaSearchResult[],
): void {
  for (const result of results) {
    if (sources.some((source) => source.url === result.url)) continue;
    sources.push({ title: result.title, url: result.url });
  }
}

function isHybridThinkingModel(model: string): boolean {
  return /^qwen3\.\d+(?:-|$)/i.test(model);
}

function isSupportedImageDataUrl(value: string): boolean {
  return (
    value.length > 32 &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
  );
}
