import { QWEN_AGENT_MODEL } from "./models.js";

const DEFAULT_QWEN_BASE_URL =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

/**
 * The dedicated LiveTranslate realtime model is only served on the
 * international DashScope endpoint, which needs its own key. The generic
 * token-plan endpoint the rest of the backend talks to does not carry this
 * model, so the live-translation WebSocket must point here.
 */
const DEFAULT_QWEN_LIVE_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export interface BackendConfig {
  dashscopeApiKey: string;
  qwenBaseUrl: string;
  qwenImageOcrModel: string;
  qwenImageTranslationModel: string;
  qwenAgentModel: string;
  qwenAsrModel: string;
  qwenVoiceTranslationModel: string;
  qwenTtsModel: string;
  qwenAudioVoice: string;
  /** Base URL + key for the LiveTranslate realtime endpoint. The model lives
   *  on a different host from the rest of the backend, so these are separate. */
  qwenLiveBaseUrl: string;
  qwenLiveApiKey: string;
  qwenLiveVoice: string;
  /** Empty when no Exa key is configured, which disables agent web search. */
  exaApiKey: string;
  host: string;
  port: number;
}

export function getConfig(): BackendConfig {
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!dashscopeApiKey) {
    throw new Error("DASHSCOPE_API_KEY is required");
  }

  const qwenBaseUrl =
    process.env.QWEN_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;
  validateQwenBaseUrl(qwenBaseUrl);

  const qwenLiveBaseUrl =
    process.env.QWEN_LIVE_BASE_URL?.trim() || DEFAULT_QWEN_LIVE_BASE_URL;
  validateQwenBaseUrl(qwenLiveBaseUrl);
  const qwenLiveApiKey =
    process.env.QWEN_LIVE_API_KEY?.trim() || dashscopeApiKey;

  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    dashscopeApiKey,
    qwenBaseUrl,
    qwenImageOcrModel:
      process.env.QWEN_IMAGE_OCR_MODEL?.trim() || "qwen3.6-flash",
    qwenImageTranslationModel:
      process.env.QWEN_IMAGE_TRANSLATION_MODEL?.trim() || "qwen3.6-flash",
    qwenAgentModel: process.env.QWEN_AGENT_MODEL?.trim() || QWEN_AGENT_MODEL,
    qwenAsrModel:
      process.env.QWEN_ASR_MODEL?.trim() || "qwen-audio-3.0-realtime-plus",
    qwenVoiceTranslationModel:
      process.env.QWEN_VOICE_TRANSLATION_MODEL?.trim() || "qwen3.6-flash",
    qwenTtsModel:
      process.env.QWEN_TTS_MODEL?.trim() || "qwen-audio-3.0-tts-plus",
    qwenAudioVoice: process.env.QWEN_AUDIO_VOICE?.trim() || "longanlingxin",
    qwenLiveBaseUrl,
    qwenLiveApiKey,
    qwenLiveVoice: process.env.QWEN_LIVE_VOICE?.trim() || "Tina",
    exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
    host: process.env.HOST ?? "0.0.0.0",
    port,
  };
}

function validateQwenBaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("QWEN_BASE_URL must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "wss:") {
    throw new Error("QWEN_BASE_URL must use HTTPS or WSS");
  }
}
