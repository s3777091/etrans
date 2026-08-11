import type {
  AgentChatMessage,
  AgentClientEvent,
  AgentSource,
} from "./agent-client";

export function createAssistantPlaceholder(id: string): AgentChatMessage {
  return {
    id,
    role: "assistant",
    text: "",
    reasoning: "",
    sources: [],
    searches: [],
    status: "streaming",
    createdAt: Date.now(),
  };
}

/**
 * Folds one streamed server event into the chat list. Only the message that
 * is currently streaming can change, so late events from a cancelled turn are
 * ignored instead of corrupting older answers.
 */
export function applyAgentEvent(
  messages: AgentChatMessage[],
  streamingId: string,
  event: AgentClientEvent,
): AgentChatMessage[] {
  const index = messages.findIndex((message) => message.id === streamingId);
  if (index < 0) return messages;
  const current = messages[index]!;
  const next = reduceMessage(current, event);
  if (next === current) return messages;
  const updated = messages.slice();
  updated[index] = next;
  return updated;
}

function reduceMessage(
  message: AgentChatMessage,
  event: AgentClientEvent,
): AgentChatMessage {
  switch (event.type) {
    case "agent.reasoning":
      return { ...message, reasoning: (message.reasoning ?? "") + event.text };
    case "agent.delta":
      return { ...message, text: message.text + event.text };
    case "agent.tool":
      if (event.status === "start") {
        return {
          ...message,
          searches: [...(message.searches ?? []), event.query],
        };
      }
      if (event.status === "done") {
        return {
          ...message,
          sources: mergeSources(message.sources, event.sources),
        };
      }
      return message;
    case "agent.done":
      return {
        ...message,
        text: event.text || message.text,
        sources: mergeSources(message.sources, event.sources),
        status: "done",
      };
    case "agent.error":
      return {
        ...message,
        text: message.text.trim()
          ? `${message.text.trim()}\n\n${event.message}`
          : event.message,
        status: "error",
      };
    default:
      return message;
  }
}

function mergeSources(
  current: AgentSource[] | undefined,
  incoming: readonly AgentSource[] | undefined,
): AgentSource[] {
  const merged = current ? current.slice() : [];
  for (const source of incoming ?? []) {
    if (merged.some((existing) => existing.url === source.url)) continue;
    merged.push(source);
  }
  return merged;
}
