import { QWEN_LIVE_MODEL } from "./models.js";

const DEFAULT_QWEN_BASE_URL =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

export interface BackendConfig {
  dashscopeApiKey: string;
  qwenBaseUrl: string;
  qwenLiveModel: string;
  qwenImageOcrModel: string;
  qwenImageTranslationModel: string;
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

  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    dashscopeApiKey,
    qwenBaseUrl,
    qwenLiveModel: process.env.QWEN_LIVE_MODEL?.trim() || QWEN_LIVE_MODEL,
    qwenImageOcrModel:
      process.env.QWEN_IMAGE_OCR_MODEL?.trim() || "qwen3.6-flash",
    qwenImageTranslationModel:
      process.env.QWEN_IMAGE_TRANSLATION_MODEL?.trim() || "qwen3.6-flash",
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
