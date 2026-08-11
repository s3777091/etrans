import WebSocket, { type RawData } from "ws";

import { type BackendConfig } from "../config.js";
import { buildQwenRealtimeUrl } from "../qwen-urls.js";
import {
  agentErrorEvent,
  buildSystemPrompt,
  lockLatestAgentMessageLanguage,
  MAX_TOOL_ROUNDS,
  WEB_SEARCH_TOOL_NAME,
  webSearchTool,
  type AgentEvent,
  type AgentMessage,
  type AgentSource,
  type AgentTurnRequest,
} from "./agent.js";
import {
  ExaSearchError,
  formatExaResults,
  searchExa,
  type ExaSearchResult,
} from "./exa.js";
import { parseToolArguments } from "./stream.js";

const AGENT_REALTIME_TIMEOUT_MS = 120_000;

interface RealtimeMessage {
  type?: string;
  text?: string;
  delta?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: {
    status?: string;
    status_details?: { reason?: string };
  };
  error?: { code?: string; message?: string };
}

interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
}

/**
 * Runs an agent turn against the `qwen-audio-3.0-realtime-plus` realtime
 * session on the token-plan endpoint. The phone already transcribed the
 * spoken question (same model, in `/v1/agent/transcribe`), so the turn feeds
 * the conversation in as `input_text` items plus the web_search tool, and
 * streams the answer back as text — one realtime model for the whole agent,
 * no second chat-completions model in the chain.
 */
export async function runRealtimeAgentTurn(
  config: BackendConfig,
  request: AgentTurnRequest,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const searchEnabled = request.search && Boolean(config.exaApiKey);
  const turn: AgentTurnRequest = { ...request, search: searchEnabled };
  const messages = lockLatestAgentMessageLanguage(turn.messages, turn.language);

  emit({ type: "agent.start" });

  // Abort the upstream search if either the caller cancels or the whole turn
  // times out, so a slow Exa request cannot outlive the session.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort);

  return new Promise<void>((resolve) => {
    const socket = new WebSocket(
      buildQwenRealtimeUrl(config.qwenBaseUrl, config.qwenAsrModel),
      { headers: { Authorization: `Bearer ${config.dashscopeApiKey}` } },
    );

    let settled = false;
    let closed = false;
    let answer = "";
    const collectedSources: AgentSource[] = [];
    let toolRounds = 0;
    /** Only the first text-event family that fires feeds the answer, so a
     *  model emitting both `response.text.*` and `response.output_text.*`
     *  cannot double the streamed text. */
    let textFamily: "text" | "output_text" | null = null;
    let pendingCalls: PendingToolCall[] = [];
    let itemsCreated = false;

    const timeout = setTimeout(() => {
      controller.abort();
      fail(new RealtimeAgentError("Trợ lý mất quá nhiều thời gian", 0));
    }, AGENT_REALTIME_TIMEOUT_MS);

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onCallerAbort);
      controller.abort();
      closeSocket();
      resolve();
    }

    function fail(error: unknown): void {
      if (settled) return;
      emit(agentErrorEvent(error, signal?.aborted === true));
      finish();
    }

    function closeSocket(): void {
      if (closed) return;
      closed = true;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "Agent turn complete");
      }
    }

    function send(event: Record<string, unknown>): void {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    }

    function createConversationItems(): void {
      if (itemsCreated) return;
      itemsCreated = true;
      for (const message of messages) {
        send({
          type: "conversation.item.create",
          item: buildConversationItem(message),
        });
      }
    }

    function requestResponse(): void {
      pendingCalls = [];
      send({ type: "response.create", response: { modalities: ["text"] } });
    }

    socket.on("unexpected-response", (_request, response) => {
      const authFailure =
        response.statusCode === 401 || response.statusCode === 403;
      fail(
        new RealtimeAgentError(
          authFailure
            ? "Không thể xác thực với Qwen"
            : "Dịch vụ trợ lý từ chối kết nối",
          response.statusCode ?? 0,
        ),
      );
    });
    socket.on("error", () => {
      if (!settled) fail(new RealtimeAgentError("Không kết nối được trợ lý", 0));
    });
    socket.on("close", () => {
      if (!settled) fail(new RealtimeAgentError("Trợ lý đã đóng kết nối", 0));
    });

    socket.on("message", (raw: RawData, isBinary: boolean) => {
      if (isBinary || settled) return;
      let message: RealtimeMessage;
      try {
        message = JSON.parse(raw.toString()) as RealtimeMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "session.created":
          send(buildAgentRealtimeSessionUpdate(turn, searchEnabled));
          return;
        case "session.updated":
          createConversationItems();
          requestResponse();
          return;
        case "response.text.delta":
        case "response.output_text.delta": {
          const family =
            message.type === "response.text.delta" ? "text" : "output_text";
          if (textFamily === null) textFamily = family;
          if (textFamily !== family) return;
          const delta = message.delta ?? "";
          if (!delta) return;
          answer += delta;
          emit({ type: "agent.delta", text: delta });
          return;
        }
        case "response.function_call_arguments.done": {
          const callId = message.call_id ?? message.item_id ?? "";
          if (!callId) return;
          pendingCalls.push({
            callId,
            name: message.name || WEB_SEARCH_TOOL_NAME,
            arguments: message.arguments ?? "",
          });
          return;
        }
        case "response.done":
          void onResponseDone(message).catch((error) => fail(error));
          return;
        case "error":
          fail(
            new RealtimeAgentError(
              message.error?.message || "Trợ lý realtime báo lỗi",
              0,
            ),
          );
          return;
        default:
          return;
      }
    });

    async function onResponseDone(message: RealtimeMessage): Promise<void> {
      if (message.response?.status !== "completed") {
        fail(
          new RealtimeAgentError(
            message.response?.status_details?.reason ||
              "Trợ lý không trả lời được",
            0,
          ),
        );
        return;
      }

      const calls = pendingCalls;
      pendingCalls = [];
      if (calls.length === 0 || toolRounds >= MAX_TOOL_ROUNDS) {
        emit({ type: "agent.done", text: answer, sources: collectedSources });
        finish();
        return;
      }
      toolRounds += 1;
      for (const call of calls) {
        await runToolCall(call);
      }
      // The tool outputs are now in the conversation; ask the model to answer.
      requestResponse();
    }

    async function runToolCall(call: PendingToolCall): Promise<void> {
      const args = parseToolArguments(call.arguments);
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const numResults =
        typeof args.numResults === "number" ? args.numResults : 5;

      if (!query) {
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: "The query parameter was empty, so no search was run.",
          },
        });
        return;
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
          controller.signal,
        );
        collectSources(collectedSources, results);
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
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: formatExaResults(results),
          },
        });
      } catch (error) {
        const failureMessage =
          error instanceof ExaSearchError
            ? error.message
            : "Web search is unavailable right now.";
        emit({
          type: "agent.tool",
          status: "failed",
          name: WEB_SEARCH_TOOL_NAME,
          query,
          message: failureMessage,
        });
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: `${failureMessage} Answer using what you already know and say that the information may be out of date.`,
          },
        });
      }
    }
  });
}

export function buildAgentRealtimeSessionUpdate(
  turn: AgentTurnRequest,
  searchEnabled: boolean,
): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      modalities: ["text"],
      instructions: buildSystemPrompt(turn),
      // The turn is driven by response.create after each user message and
      // each tool result, so the model must not close turns on its own.
      turn_detection: null,
      ...(searchEnabled ? { tools: [webSearchTool()] } : {}),
    },
  };
}

function buildConversationItem(message: AgentMessage): Record<string, unknown> {
  const text = messageText(message);
  if (message.role === "user") {
    return {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    };
  }
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
  };
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
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

/** Carries the upstream status code so `agentErrorEvent` can map auth/model
 *  failures without importing `AgentUpstreamError` (which would create a
 *  circular module dependency at class-evaluation time). */
class RealtimeAgentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "RealtimeAgentError";
  }
}