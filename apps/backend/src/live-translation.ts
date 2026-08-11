import WebSocket, { type RawData } from "ws";

import { type BackendConfig } from "./config.js";
import {
  languagesForDirection,
  type InterpreterDirection,
} from "./models.js";
import { buildQwenRealtimeUrl } from "./qwen-urls.js";

const TURN_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** 100 ms of 16 kHz mono PCM16, the frame size the realtime endpoint expects. */
const AUDIO_FRAME_BYTES = 3_200;

/**
 * The dedicated LiveTranslate realtime model ships its own ASR + translation
 * pipeline. Setting input_audio_transcription.model turns the source-language
 * recognition on, and input_audio_transcription.language then LOCKS it so the
 * model never auto-detects (the bug: Vietnamese heard as Chinese). The
 * translation.language field points the output at the target language.
 */
const LIVE_TRANSLATE_ASR_MODEL = "qwen3-asr-flash-realtime";

interface RealtimeServerMessage {
  type?: string;
  transcript?: string;
  delta?: string;
  response?: {
    status?: string;
    status_details?: { reason?: string };
  };
  error?: { code?: string; message?: string };
}

export class RealtimeTranslationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUTH_UNAVAILABLE"
      | "MODEL_UNAVAILABLE"
      | "TRANSLATION_UNAVAILABLE",
  ) {
    super(message);
    this.name = "RealtimeTranslationError";
  }
}

/**
 * The drag gesture has already chosen which way this turn runs, so the source
 * language is locked here, not left to the model to auto-detect. The dedicated
 * LiveTranslate model hears the speaker in the locked source language and
 * answers in the target — one session, no transcribe->translate->speak chain.
 */
export function createTranslationSessionUpdate(
  direction: InterpreterDirection,
  voice: string,
  eventId?: string,
): Record<string, unknown> {
  const { source, target } = languagesForDirection(direction);
  return {
    ...(eventId ? { event_id: eventId } : {}),
    type: "session.update",
    session: {
      modalities: ["audio", "text"],
      voice,
      input_audio_format: "pcm",
      output_audio_format: "pcm",
      // `model` turns source-language recognition on; `language` then LOCKS it
      // so the model never auto-detects. Without this the generic realtime
      // model hears Vietnamese as Chinese and "translates" Chinese->Chinese.
      input_audio_transcription: {
        model: LIVE_TRANSLATE_ASR_MODEL,
        language: source,
      },
      translation: { language: target },
      // Segment boundaries come from the server-side VAD in this backend, so
      // the model must not close turns on its own.
      turn_detection: null,
    },
  };
}

/**
 * Qwen's realtime events carry the phone's own event names for the parts the
 * app consumes, except for the ones it must not see: partial transcripts can
 * split mid-word, and turn bookkeeping belongs to the route.
 */
export function clientEventForServerMessage(
  message: RealtimeServerMessage,
): Record<string, unknown> | undefined {
  switch (message.type) {
    case "conversation.item.input_audio_transcription.completed":
      return message.transcript?.trim()
        ? {
            type: "conversation.item.input_audio_transcription.completed",
            transcript: message.transcript,
          }
        : undefined;
    case "response.audio_transcript.done":
      return message.transcript?.trim()
        ? {
            type: "response.audio_transcript.done",
            transcript: message.transcript,
          }
        : undefined;
    case "response.audio.delta":
      return message.delta
        ? { type: "response.audio.delta", delta: message.delta }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * One upstream realtime session, reused for every sentence in a client
 * session. Sentences are translated one at a time: the segmenter has already
 * decided where each one ends.
 */
export class RealtimeTranslationSession {
  private socket: WebSocket | undefined;
  private opening: Promise<void> | undefined;
  /** True only after the upstream has acked session.update, not merely after
   *  the WebSocket finishes its handshake. Audio sent before this lands is
   *  processed against an unconfigured session and the model answers nothing. */
  private sessionReady = false;
  private turn:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private closed = false;

  constructor(
    private readonly config: BackendConfig,
    private readonly direction: InterpreterDirection,
    private readonly model: string,
    private readonly onEvent: (event: Record<string, unknown>) => void,
  ) {}

  /** Opened while the user is still speaking so the handshake costs nothing. */
  open(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new RealtimeTranslationError(
          "Phiên dịch đã đóng",
          "TRANSLATION_UNAVAILABLE",
        ),
      );
    }
    if (this.sessionReady) return Promise.resolve();
    this.opening ??= this.openSocket().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  async translate(pcm: Buffer): Promise<void> {
    await this.open();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new RealtimeTranslationError(
        "Mất kết nối dịch vụ phiên dịch",
        "TRANSLATION_UNAVAILABLE",
      );
    }

    return new Promise<void>((resolve, reject) => {
      this.turn = {
        resolve,
        reject,
        timer: setTimeout(
          () =>
            this.failTurn(
              new RealtimeTranslationError(
                "Phiên dịch mất quá nhiều thời gian",
                "TRANSLATION_UNAVAILABLE",
              ),
            ),
          TURN_TIMEOUT_MS,
        ),
      };

      for (let offset = 0; offset < pcm.length; offset += AUDIO_FRAME_BYTES) {
        this.send({
          type: "input_audio_buffer.append",
          audio: pcm
            .subarray(offset, offset + AUDIO_FRAME_BYTES)
            .toString("base64"),
        });
      }
      // The LiveTranslate model emits the source transcript, the target
      // translation, and the spoken translation audio in response to the
      // commit alone — a response.create event is invalid for this model.
      this.send({ type: "input_audio_buffer.commit" });
    });
  }

  close(): void {
    this.closed = true;
    this.sessionReady = false;
    this.finishTurn();
    const socket = this.socket;
    this.socket = undefined;
    if (
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, "Session closed");
    }
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        buildQwenRealtimeUrl(this.config.qwenLiveBaseUrl, this.model),
        { headers: { Authorization: `Bearer ${this.config.qwenLiveApiKey}` } },
      );
      this.socket = socket;
      let settled = false;

      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      const timeout = setTimeout(
        () =>
          settle(
            new RealtimeTranslationError(
              "Không kết nối được dịch vụ phiên dịch",
              "TRANSLATION_UNAVAILABLE",
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );

      socket.on("message", (raw: RawData, isBinary: boolean) => {
        if (isBinary) return;
        let message: RealtimeServerMessage;
        try {
          message = JSON.parse(raw.toString()) as RealtimeServerMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case "session.created":
            this.send(
              createTranslationSessionUpdate(
                this.direction,
                this.config.qwenLiveVoice,
              ),
            );
            return;
          case "session.updated":
            this.sessionReady = true;
            settle();
            return;
          case "response.done":
            if (message.response?.status === "completed") {
              this.finishTurn();
            } else {
              this.failTurn(
                new RealtimeTranslationError(
                  message.response?.status_details?.reason ||
                    "Không dịch được câu này",
                  "TRANSLATION_UNAVAILABLE",
                ),
              );
            }
            return;
          case "error": {
            const error = new RealtimeTranslationError(
              message.error?.message || "Dịch vụ phiên dịch báo lỗi",
              /model|not found|not exist/i.test(
                `${message.error?.code} ${message.error?.message}`,
              )
                ? "MODEL_UNAVAILABLE"
                : "TRANSLATION_UNAVAILABLE",
            );
            settle(error);
            this.failTurn(error);
            return;
          }
        }

        const event = clientEventForServerMessage(message);
        if (event) this.onEvent(event);
      });

      socket.on("unexpected-response", (_request, response) => {
        const authFailure =
          response.statusCode === 401 || response.statusCode === 403;
        const error = new RealtimeTranslationError(
          authFailure
            ? "Không thể xác thực dịch vụ phiên dịch"
            : "Dịch vụ phiên dịch từ chối kết nối",
          authFailure ? "AUTH_UNAVAILABLE" : "MODEL_UNAVAILABLE",
        );
        settle(error);
        this.failTurn(error);
      });
      socket.on("error", () => {
        const error = new RealtimeTranslationError(
          "Không kết nối được dịch vụ phiên dịch",
          "TRANSLATION_UNAVAILABLE",
        );
        settle(error);
        this.failTurn(error);
      });
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.sessionReady = false;
        }
        const error = new RealtimeTranslationError(
          "Dịch vụ phiên dịch đóng kết nối",
          "TRANSLATION_UNAVAILABLE",
        );
        settle(error);
        this.failTurn(error);
      });
    });
  }

  private finishTurn(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    clearTimeout(turn.timer);
    turn.resolve();
  }

  private failTurn(error: Error): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    clearTimeout(turn.timer);
    turn.reject(error);
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }
}
