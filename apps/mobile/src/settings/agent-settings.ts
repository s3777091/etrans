import type { TranslationLanguage } from "../qwen/types";

// Mirrors the models the backend accepts for agent turns.
export const AGENT_MODELS = [
  "qwen3.6-flash",
  "qwen3.7-plus",
  "qwen3.7-max",
  "qwen3.8-max",
] as const;

export type AgentModel = (typeof AGENT_MODELS)[number];
export type AgentLanguage = TranslationLanguage;

/**
 * Vietnamese is the frame already sitting at the bottom of the translate
 * screen, so the orb only has to fall. Any other language starts by lifting
 * the orb out of the layout before it drops into the new chat frame.
 */
export type AgentEntrance = "drop" | "rise-then-drop";

export interface AgentSettings {
  language: AgentLanguage;
  model: AgentModel;
  reasoning: boolean;
  search: boolean;
  prompt: string;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  language: "vi",
  model: "qwen3.6-flash",
  reasoning: false,
  search: true,
  prompt: "",
};

export const AGENT_LANGUAGES: readonly AgentLanguage[] = ["vi", "zh", "en"];

export const MAX_AGENT_PROMPT_LENGTH = 1_200;

export function parseAgentSettings(
  value: string | null | undefined,
): AgentSettings {
  if (!value) return { ...DEFAULT_AGENT_SETTINGS };
  try {
    const candidate = JSON.parse(value) as Partial<AgentSettings>;
    return {
      language: isAgentLanguage(candidate.language)
        ? candidate.language
        : DEFAULT_AGENT_SETTINGS.language,
      model: isAgentModel(candidate.model)
        ? candidate.model
        : DEFAULT_AGENT_SETTINGS.model,
      reasoning: candidate.reasoning === true,
      search: candidate.search !== false,
      prompt:
        typeof candidate.prompt === "string"
          ? candidate.prompt.slice(0, MAX_AGENT_PROMPT_LENGTH)
          : "",
    };
  } catch {
    return { ...DEFAULT_AGENT_SETTINGS };
  }
}

export function agentEntranceForLanguage(
  language: AgentLanguage,
): AgentEntrance {
  return language === "vi" ? "drop" : "rise-then-drop";
}

export function isAgentLanguage(value: unknown): value is AgentLanguage {
  return value === "vi" || value === "zh" || value === "en";
}

export function isAgentModel(value: unknown): value is AgentModel {
  return AGENT_MODELS.includes(value as AgentModel);
}
