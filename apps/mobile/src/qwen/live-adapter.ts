import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64";
import { classifyQwenError, createQwenLiveError } from "./errors";
import {
  QWEN_LIVE_MODEL,
  languagesForDirection,
  type InterpreterDirection,
  type QwenLiveAdapterContract,
  type QwenLiveError,
  type VoiceTranslationModel,
} from "./types";

const CONNECT_TIMEOUT_MS = 8_000;
const FINISH_TIMEOUT_MS = 15_000;
const ZH_TO_VI_HOTWORDS = parseHotwords(
  process.env.EXPO_PUBLIC_QWEN_HOTWORDS_ZH_TO_VI,
);
const VI_TO_ZH_HOTWORDS = parseHotwords(
  process.env.EXPO_PUBLIC_QWEN_HOTWORDS_VI_TO_ZH,
);

interface QwenServerMessage {
  type?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  delta?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

type VoidCallback = () => void;

export class QwenLiveTranslateAdapter
  implements QwenLiveAdapterContract
{
  readonly modelId: VoiceTranslationModel;

  private socket: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private setupReady = false;
  private inputStarted = false;
  private intentionalClose = false;
  private suppressCloseError = false;
  private sessionUpdateSent = false;
  private finishSent = false;
  private turnCompleteEmitted = false;
  private websocketRttMs: number | undefined;
  private eventCounter = 0;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly inputTranscriptCallbacks = new Set<(text: string) => void>();
  private readonly outputTranscriptCallbacks = new Set<(text: string) => void>();
  private readonly audioCallbacks = new Set<(pcm: ArrayBuffer) => void>();
  private readonly errorCallbacks = new Set<(error: QwenLiveError) => void>();
  private readonly turnCompleteCallbacks = new Set<VoidCallback>();

  constructor(
    private readonly apiBaseUrl: string,
    private readonly direction: InterpreterDirection,
    modelId: VoiceTranslationModel = QWEN_LIVE_MODEL,
  ) {
    this.modelId = modelId;
  }

  connect(): Promise<void> {
    if (this.setupReady && this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connecting) return this.connecting;

    this.connecting = this.openSocket().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async startInput(): Promise<void> {
    await this.connect();
    this.inputStarted = true;
    this.finishSent = false;
    this.turnCompleteEmitted = false;
  }

  sendAudio(buffer: ArrayBuffer): void {
    if (
      !this.inputStarted ||
      !this.setupReady ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    this.send({
      event_id: this.nextEventId(),
      type: "input_audio_buffer.append",
      audio: arrayBufferToBase64(buffer),
    });
  }

  async stopInput(): Promise<void> {
    this.inputStarted = false;
    if (
      this.finishSent ||
      !this.setupReady ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    this.finishSent = true;
    this.send({
      event_id: this.nextEventId(),
      type: "session.finish",
    });
    this.finishTimer = setTimeout(() => {
      this.emitError(
        createQwenLiveError({
          message: "Qwen realtime finish timeout",
          code: "NETWORK_ERROR",
          scope: "network",
          retryable: true,
        }),
      );
      void this.disconnect();
    }, FINISH_TIMEOUT_MS);
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.inputStarted = false;
    this.setupReady = false;
    this.clearFinishTimer();
    const socket = this.socket;
    this.socket = undefined;
    if (
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, "Client disconnect");
    }
  }

  onInputTranscript(callback: (text: string) => void): void {
    this.inputTranscriptCallbacks.add(callback);
  }

  onOutputTranscript(callback: (text: string) => void): void {
    this.outputTranscriptCallbacks.add(callback);
  }

  onAudio(callback: (pcm: ArrayBuffer) => void): void {
    this.audioCallbacks.add(callback);
  }

  onError(callback: (error: QwenLiveError) => void): void {
    this.errorCallbacks.add(callback);
  }

  onTurnComplete(callback: VoidCallback): void {
    this.turnCompleteCallbacks.add(callback);
  }

  getWebSocketRtt(): number | undefined {
    return this.websocketRttMs;
  }

  private async openSocket(): Promise<void> {
    const socket = new WebSocket(
      buildQwenProxyWebSocketUrl(
        this.apiBaseUrl,
        this.direction,
        this.modelId,
      ),
    );
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.intentionalClose = false;
    this.suppressCloseError = false;
    this.setupReady = false;
    this.sessionUpdateSent = false;
    this.finishSent = false;
    this.turnCompleteEmitted = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let openedAt = 0;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.suppressCloseError = true;
        socket.close();
        reject(
          createQwenLiveError({
            message: "Qwen realtime connection timeout",
            code: "NETWORK_ERROR",
            scope: "network",
            retryable: true,
          }),
        );
      }, CONNECT_TIMEOUT_MS);

      const sendSessionUpdate = () => {
        if (this.sessionUpdateSent || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        this.sessionUpdateSent = true;
        this.send(
          createSessionUpdate(
            this.direction,
            this.nextEventId(),
            configuredHotwords(this.direction),
          ),
        );
      };

      socket.onopen = () => {
        openedAt = Date.now();
      };

      socket.onmessage = async (event) => {
        try {
          const message = await decodeServerMessage(event.data);
          if (!message) return;
          if (message.type === "session.created") {
            sendSessionUpdate();
          }
          if (message.type === "session.updated" && !settled) {
            settled = true;
            clearTimeout(timeout);
            this.setupReady = true;
            this.websocketRttMs = Date.now() - openedAt;
            resolve();
          }
          if (message.type === "proxy.error" || message.type === "error") {
            const serverError = errorFromServerMessage(message);
            this.suppressCloseError = true;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(serverError);
            } else {
              this.emitError(serverError);
            }
            return;
          }
          this.handleServerMessage(message);
        } catch (error) {
          this.emitError(
            createQwenLiveError({
              message:
                error instanceof Error
                  ? error.message
                  : "Invalid Qwen server message",
              code: "PROTOCOL_ERROR",
              scope: "protocol",
              retryable: false,
            }),
          );
        }
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        this.suppressCloseError = true;
        clearTimeout(timeout);
        reject(
          createQwenLiveError({
            message: "Qwen realtime WebSocket connection error",
            code: "NETWORK_ERROR",
            scope: "network",
            retryable: true,
          }),
        );
      };

      socket.onclose = (event) => {
        this.setupReady = false;
        this.inputStarted = false;
        this.clearFinishTimer();
        clearTimeout(timeout);
        const error = classifyQwenError(
          event.reason || `Qwen WebSocket closed (${event.code})`,
          event.code,
        );
        if (!settled) {
          settled = true;
          reject(error);
        } else if (!this.intentionalClose && !this.suppressCloseError) {
          this.emitError(error);
        }
      };
    });
  }

  private handleServerMessage(message: QwenServerMessage): void {
    switch (message.type) {
      case "conversation.item.input_audio_transcription.text":
        this.emitText(this.inputTranscriptCallbacks, message.text);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emitText(this.inputTranscriptCallbacks, message.transcript);
        break;
      case "response.audio_transcript.text":
        this.emitText(this.outputTranscriptCallbacks, message.text);
        break;
      case "response.audio_transcript.done":
        this.emitText(this.outputTranscriptCallbacks, message.transcript);
        break;
      case "response.audio.delta":
        if (message.delta) {
          const pcm = base64ToArrayBuffer(message.delta);
          this.audioCallbacks.forEach((callback) => callback(pcm));
        }
        break;
      case "session.finished":
        this.completeTurn();
        break;
    }
  }

  private completeTurn(): void {
    if (this.turnCompleteEmitted) return;
    this.turnCompleteEmitted = true;
    this.intentionalClose = true;
    this.inputStarted = false;
    this.setupReady = false;
    this.clearFinishTimer();
    this.turnCompleteCallbacks.forEach((callback) => callback());
    this.socket?.close(1000, "Session finished");
  }

  private emitText(callbacks: Set<(text: string) => void>, text?: string): void {
    if (!text) return;
    callbacks.forEach((callback) => callback(text));
  }

  private emitError(error: QwenLiveError): void {
    this.errorCallbacks.forEach((callback) => callback(error));
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `event_${Date.now()}_${this.eventCounter}`;
  }

  private clearFinishTimer(): void {
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = undefined;
    }
  }
}

export function buildQwenProxyWebSocketUrl(
  apiBaseUrl: string,
  direction: InterpreterDirection,
  model: VoiceTranslationModel = QWEN_LIVE_MODEL,
): string {
  const url = new URL("/v1/qwen/live", ensureTrailingSlash(apiBaseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("direction", direction);
  url.searchParams.set("model", model);
  return url.toString();
}

export function createSessionUpdate(
  direction: InterpreterDirection,
  eventId = "event_session_update",
  hotwords: Record<string, string> = {},
): Record<string, unknown> {
  const { source, target } = languagesForDirection(direction);
  const hasHotwords = Object.keys(hotwords).length > 0;
  return {
    event_id: eventId,
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      voice: "Tina",
      sample_rate: 16_000,
      input_audio_format: "pcm",
      output_audio_format: "pcm",
      input_audio_transcription: {
        model: "qwen3-asr-flash-realtime",
        language: source,
      },
      translation: {
        language: target,
        ...(hasHotwords ? { corpus: { phrases: hotwords } } : {}),
      },
    },
  };
}

export function parseHotwords(
  value: string | undefined,
): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" &&
            entry[0].trim().length > 0 &&
            entry[1].trim().length > 0,
        )
        .slice(0, 100)
        .map(([source, target]) => [source.trim(), target.trim()]),
    );
  } catch {
    return {};
  }
}

function configuredHotwords(
  direction: InterpreterDirection,
): Record<string, string> {
  if (direction === "zh-to-vi") return ZH_TO_VI_HOTWORDS;
  if (direction === "vi-to-zh") return VI_TO_ZH_HOTWORDS;
  return {};
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function decodeServerMessage(
  data: string | ArrayBuffer | Blob,
): Promise<QwenServerMessage | undefined> {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (typeof data.text === "function") {
    text = await data.text();
  } else {
    return undefined;
  }
  return JSON.parse(text) as QwenServerMessage;
}

function errorFromServerMessage(message: QwenServerMessage): QwenLiveError {
  const messageText = [message.error?.code, message.error?.message]
    .filter(Boolean)
    .join(": ") || "Qwen realtime service error";
  return classifyQwenError(messageText);
}
