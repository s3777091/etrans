import WebSocket from "ws";

import { type BackendConfig } from "../config.js";
import { type AgentLanguage } from "../models.js";
import { buildQwenRealtimeUrl } from "../qwen-urls.js";

const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** 100 ms of 16 kHz mono PCM16, matching the realtime sample rate. */
const AUDIO_CHUNK_BYTES = 3_200;
/** Upload recorded speech faster than realtime without overwhelming Qwen ASR. */
const AUDIO_CHUNK_INTERVAL_MS = 40;
export const MAX_AUDIO_DATA_URL_LENGTH = 8 * 1024 * 1024;

interface RealtimeMessage {
  type?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  error?: { code?: string; message?: string };
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly code: "AUTH_UNAVAILABLE" | "ASR_UNAVAILABLE" | "EMPTY_SPEECH",
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export function isSupportedAudioDataUrl(value: string): boolean {
  return (
    value.length > 64 &&
    value.length <= MAX_AUDIO_DATA_URL_LENGTH &&
    /^data:audio\/(?:wav|x-wav|wave);base64,/i.test(value)
  );
}

/**
 * The realtime endpoint takes raw PCM frames, so the WAV container the phone
 * records has to be unwrapped down to its data chunk.
 */
export function pcmFromWavDataUrl(value: string): Buffer | undefined {
  const separator = value.indexOf(",");
  if (separator < 0) return undefined;
  const buffer = Buffer.from(value.slice(separator + 1), "base64");
  if (buffer.length <= 44) return undefined;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return buffer;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === "data") {
      const end = Math.min(buffer.length, dataStart + chunkSize);
      return end > dataStart ? buffer.subarray(dataStart, end) : undefined;
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return undefined;
}

export function createAsrSessionUpdate(
  language: AgentLanguage,
): Record<string, unknown> {
  return {
    event_id: "event_asr_session_update",
    type: "session.update",
    session: {
      modalities: ["text"],
      input_audio_format: "pcm",
      turn_detection: null,
      input_audio_transcription: {
        language,
      },
    },
  };
}

/** Qwen wraps language ids and silence markers in `<|...|>` tags. */
export function cleanTranscript(value: string): string {
  return value
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribeSpeech(
  config: BackendConfig,
  audioDataUrl: string,
  language: AgentLanguage,
): Promise<string> {
  const pcm = pcmFromWavDataUrl(audioDataUrl);
  if (!pcm?.length) {
    throw new TranscriptionError(
      "Bản ghi âm không hợp lệ",
      "ASR_UNAVAILABLE",
    );
  }

  const transcript = cleanTranscript(
    await runRealtimeTranscription(config, pcm, language),
  );
  if (!transcript) {
    throw new TranscriptionError(
      "Không nghe rõ nội dung, hãy thử nói lại",
      "EMPTY_SPEECH",
    );
  }
  return transcript;
}

function runRealtimeTranscription(
  config: BackendConfig,
  pcm: Buffer,
  language: AgentLanguage,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(
      buildQwenRealtimeUrl(config.qwenBaseUrl, config.qwenAsrModel),
      { headers: { Authorization: `Bearer ${config.dashscopeApiKey}` } },
    );
    let settled = false;
    let partial = "";
    let audioOffset = 0;
    let audioTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: { text?: string; error?: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(audioTimer);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "Transcription complete");
      }
      if (outcome.error) reject(outcome.error);
      else resolve(outcome.text ?? partial);
    };

    const timeout = setTimeout(
      () =>
        finish({
          error: new TranscriptionError(
            "Nhận dạng giọng nói quá lâu",
            "ASR_UNAVAILABLE",
          ),
        }),
      TRANSCRIBE_TIMEOUT_MS,
    );

    const sendNextAudioChunk = () => {
      if (settled || socket.readyState !== WebSocket.OPEN) return;
      if (audioOffset >= pcm.length) {
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        return;
      }
      const chunk = pcm.subarray(
        audioOffset,
        audioOffset + AUDIO_CHUNK_BYTES,
      );
      audioOffset += chunk.length;
      socket.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: chunk.toString("base64"),
        }),
      );
      audioTimer = setTimeout(sendNextAudioChunk, AUDIO_CHUNK_INTERVAL_MS);
    };

    socket.on("unexpected-response", (_request, response) => {
      const authFailure =
        response.statusCode === 401 || response.statusCode === 403;
      finish({
        error: new TranscriptionError(
          authFailure
            ? "Không thể xác thực với Qwen"
            : "Không thể nhận dạng giọng nói lúc này",
          authFailure ? "AUTH_UNAVAILABLE" : "ASR_UNAVAILABLE",
        ),
      });
    });

    socket.on("error", () =>
      finish({
        error: new TranscriptionError(
          "Không thể kết nối dịch vụ nhận dạng giọng nói",
          "ASR_UNAVAILABLE",
        ),
      }),
    );

    socket.on("close", () => finish({}));

    socket.on("message", (raw) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(raw.toString()) as RealtimeMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "session.created":
          socket.send(
            JSON.stringify(createAsrSessionUpdate(language)),
          );
          break;
        case "session.updated":
          sendNextAudioChunk();
          break;
        case "conversation.item.input_audio_transcription.delta":
          partial = `${message.text ?? ""}${message.stash ?? ""}`;
          break;
        case "conversation.item.input_audio_transcription.completed":
          finish({ text: message.transcript ?? partial });
          break;
        case "conversation.item.input_audio_transcription.failed":
        case "error":
          finish({
            error: new TranscriptionError(
              message.error?.message || "Không thể nhận dạng giọng nói lúc này",
              "ASR_UNAVAILABLE",
            ),
          });
          break;
      }
    });
  });
}
