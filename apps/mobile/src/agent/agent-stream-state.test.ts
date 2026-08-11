import { describe, expect, it } from "vitest";

import type { AgentChatMessage } from "./agent-client";
import { applyAgentEvent, createAssistantPlaceholder } from "./agent-stream-state";

describe("agent stream state", () => {
  it("builds one answer from the streamed events", () => {
    const placeholder = createAssistantPlaceholder("a1");
    let messages: AgentChatMessage[] = [
      { id: "u1", role: "user", text: "Thời tiết?", createdAt: 0 },
      placeholder,
    ];

    for (const event of [
      { type: "agent.reasoning", text: "cần tra cứu" },
      { type: "agent.tool", status: "start", name: "web_search", query: "thời tiết Hà Nội" },
      {
        type: "agent.tool",
        status: "done",
        name: "web_search",
        query: "thời tiết Hà Nội",
        sources: [{ title: "Dự báo", url: "https://example.com/a" }],
      },
      { type: "agent.delta", text: "Hà Nội " },
      { type: "agent.delta", text: "30 độ" },
      {
        type: "agent.done",
        text: "Hà Nội 30 độ",
        sources: [{ title: "Dự báo", url: "https://example.com/a" }],
      },
    ] as const) {
      messages = applyAgentEvent(messages, "a1", event);
    }

    expect(messages[1]).toMatchObject({
      text: "Hà Nội 30 độ",
      reasoning: "cần tra cứu",
      searches: ["thời tiết Hà Nội"],
      sources: [{ title: "Dự báo", url: "https://example.com/a" }],
      status: "done",
    });
  });

  it("keeps partial text when the turn fails and ignores unknown ids", () => {
    const messages: AgentChatMessage[] = [
      { ...createAssistantPlaceholder("a1"), text: "Một phần" },
    ];

    const failed = applyAgentEvent(messages, "a1", {
      type: "agent.error",
      code: "AGENT_UNAVAILABLE",
      message: "Trợ lý đang bận",
    });
    expect(failed[0]).toMatchObject({
      text: "Một phần\n\nTrợ lý đang bận",
      status: "error",
    });

    expect(
      applyAgentEvent(messages, "missing", { type: "agent.delta", text: "x" }),
    ).toBe(messages);
  });
});
