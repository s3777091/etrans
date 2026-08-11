export const QWEN_LIVE_MODEL =
  "qwen3.5-livetranslate-flash-realtime" as const;

export const QWEN_LIVE_MODELS = [
  QWEN_LIVE_MODEL,
  "qwen3-livetranslate-flash-realtime",
] as const;

// Mirrors the backend allow-list for the translation step of image translation.
export const QWEN_MT_MODELS = [
  "qwen3.6-flash",
  "qwen3.7-plus",
  "qwen3.8-max",
] as const;

export type VoiceTranslationModel = (typeof QWEN_LIVE_MODELS)[number];
export type TextTranslationModel = (typeof QWEN_MT_MODELS)[number];
export type TranslationLanguage = "vi" | "zh" | "en";
export type InterpreterDirection =
  | "zh-to-vi"
  | "vi-to-zh"
  | "en-to-vi"
  | "vi-to-en";

export function languagesForDirection(direction: InterpreterDirection): {
  source: TranslationLanguage;
  target: TranslationLanguage;
} {
  const [source, target] = direction.split("-to-") as [
    TranslationLanguage,
    TranslationLanguage,
  ];
  return { source, target };
}

export type QwenLiveErrorCode =
  | "AUTH_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "PROTOCOL_ERROR"
  | "UNKNOWN";

export type QwenLiveErrorScope =
  | "account"
  | "service"
  | "network"
  | "protocol"
  | "unknown";

export interface QwenLiveError extends Error {
  code: QwenLiveErrorCode;
  scope: QwenLiveErrorScope;
  retryable: boolean;
  closeCode?: number;
}

export interface QwenLiveAdapterContract {
  readonly modelId: VoiceTranslationModel;

  connect(): Promise<void>;
  startInput(): Promise<void>;
  sendAudio(buffer: ArrayBuffer): void;
  stopInput(): Promise<void>;
  disconnect(): Promise<void>;

  onInputTranscript(callback: (text: string) => void): void;
  onOutputTranscript(callback: (text: string) => void): void;
  onAudio(callback: (pcm: ArrayBuffer) => void): void;
  onError(callback: (error: QwenLiveError) => void): void;
  onTurnComplete(callback: () => void): void;
  getWebSocketRtt(): number | undefined;
}
