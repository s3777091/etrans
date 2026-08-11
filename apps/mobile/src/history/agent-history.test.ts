import { describe, expect, it } from "vitest";

import type { AgentChatMessage } from "../agent/agent-client";
import {
  MAX_AGENT_HISTORY_MESSAGES,
  parseAgentHistory,
  serializeAgentHistory,
} from "./agent-history";

describe("agent history", () => {
  it("stores compact text history without image payloads", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "u1",
        role: "user",
        text: "",
        imageDataUrl: "data:image/jpeg;base64,large",
        createdAt: 1,
      },
      {
        id: "a1",
        role: "assistant",
        text: "Đã phân tích ảnh",
        createdAt: 2,
      },
    ];
    const serialized = serializeAgentHistory(messages);
    expect(serialized).not.toContain("base64");
    expect(parseAgentHistory(serialized)[0]?.text).toBe("[Ảnh]");
  });

  it("drops invalid values and caps old messages", () => {
    const values = Array.from(
      { length: MAX_AGENT_HISTORY_MESSAGES + 4 },
      (_, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `Tin ${index}`,
        createdAt: index,
      }),
    );
    const parsed = parseAgentHistory(JSON.stringify([{ id: "bad" }, ...values]));
    expect(parsed).toHaveLength(MAX_AGENT_HISTORY_MESSAGES);
    expect(parsed[0]?.id).toBe("m4");
  });
});
