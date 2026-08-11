export interface StreamingToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionChunk {
  content?: string;
  reasoning?: string;
  toolCalls?: StreamingToolCall[];
  finishReason?: string;
}

interface RawToolCallDelta {
  index?: unknown;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface RawCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
    finish_reason?: unknown;
  }>;
}

/**
 * Splits a raw SSE buffer into complete events and the unterminated tail that
 * has to wait for the next network chunk.
 */
export function splitSseEvents(buffer: string): {
  events: string[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join(""),
    )
    .filter((data) => data.length > 0);
  return { events, rest };
}

export function parseCompletionChunk(data: string): CompletionChunk | undefined {
  if (data === "[DONE]") return undefined;
  let parsed: RawCompletionChunk;
  try {
    parsed = JSON.parse(data) as RawCompletionChunk;
  } catch {
    return undefined;
  }

  const choice = parsed.choices?.[0];
  if (!choice) return undefined;

  const chunk: CompletionChunk = {};
  if (typeof choice.delta?.content === "string" && choice.delta.content) {
    chunk.content = choice.delta.content;
  }
  if (
    typeof choice.delta?.reasoning_content === "string" &&
    choice.delta.reasoning_content
  ) {
    chunk.reasoning = choice.delta.reasoning_content;
  }
  if (Array.isArray(choice.delta?.tool_calls)) {
    chunk.toolCalls = choice.delta.tool_calls
      .map(toStreamingToolCall)
      .filter((call): call is StreamingToolCall => call !== undefined);
  }
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    chunk.finishReason = choice.finish_reason;
  }
  return chunk;
}

/**
 * Tool calls arrive split across chunks: the first carries the id and name,
 * later ones append argument fragments for the same index.
 */
export function mergeToolCalls(
  current: StreamingToolCall[],
  deltas: StreamingToolCall[] | undefined,
): StreamingToolCall[] {
  if (!deltas?.length) return current;
  const merged = current.map((call) => ({ ...call }));
  for (const delta of deltas) {
    const existing = merged.find((call) => call.index === delta.index);
    if (!existing) {
      merged.push({ ...delta });
      continue;
    }
    if (delta.id) existing.id = delta.id;
    if (delta.name) existing.name = delta.name;
    if (delta.arguments) existing.arguments += delta.arguments;
  }
  return merged.sort((left, right) => left.index - right.index);
}

export function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toStreamingToolCall(value: unknown): StreamingToolCall | undefined {
  const delta = value as RawToolCallDelta | null;
  if (!delta || typeof delta !== "object") return undefined;
  return {
    index: typeof delta.index === "number" ? delta.index : 0,
    id: typeof delta.id === "string" ? delta.id : "",
    name:
      typeof delta.function?.name === "string" ? delta.function.name : "",
    arguments:
      typeof delta.function?.arguments === "string"
        ? delta.function.arguments
        : "",
  };
}
