import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_SETTINGS,
  agentEntranceForLanguage,
  parseAgentSettings,
} from "./agent-settings";

describe("agent settings", () => {
  it("keeps saved values and repairs unknown ones", () => {
    const parsed = parseAgentSettings(
      JSON.stringify({
        language: "zh",
        model: "qwen3.7-plus",
        reasoning: true,
        search: false,
        prompt: "Xưng hô thân mật",
      }),
    );

    expect(parsed).toEqual({
      language: "zh",
      model: "qwen3.7-plus",
      reasoning: true,
      search: false,
      prompt: "Xưng hô thân mật",
    });

    const repaired = parseAgentSettings(
      JSON.stringify({ language: "th", model: "gpt", prompt: 12 }),
    );
    expect(repaired).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(parseAgentSettings("not json")).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(parseAgentSettings(null)).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it("drops the orb straight down only for Vietnamese", () => {
    expect(agentEntranceForLanguage("vi")).toBe("drop");
    expect(agentEntranceForLanguage("zh")).toBe("rise-then-drop");
    expect(agentEntranceForLanguage("en")).toBe("rise-then-drop");
  });
});
