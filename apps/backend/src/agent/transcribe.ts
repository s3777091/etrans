import WebSocket from "ws";

import { type BackendConfig } from "../config.js";
import { type AgentLanguage } from "../models.js";
import { buildQwenRealtimeUrl } from "../qwen-urls.js";

const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** 100 ms of 16 kHz mono PCM16, matching the realtime sample rate. */
const AUDIO_CHUNK_BYTES = 3_200;
/** Replay buffered speech quickly after VAD closes a phrase. */
const AUDIO_CHUNK_INTERVAL_MS = 2;
export const MAX_AUDIO_DATA_URL_LENGTH = 8 * 1024 * 1024;

interface RealtimeMessage {
  type?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  delta?: string;
  response?: {
    status?: string;
    status_details?: { reason?: string };
  };
  error?: { code?: string; message?: string };
}

const TRANSCRIPTION_LANGUAGE_NAMES: Record<AgentLanguage, string> = {
  vi: "Vietnamese",
  zh: "Chinese",
  en: "English",
};

type SpokenLanguage = AgentLanguage | "other" | "none";

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
  const languageName = TRANSCRIPTION_LANGUAGE_NAMES[language];
  return {
    event_id: "event_asr_session_update",
    type: "session.update",
    session: {
      modalities: ["text"],
      instructions: [
        `You are a ${languageName} speech transcription engine, not an assistant or translator.`,
        `The audio language is fixed as ${languageName} by the user interface; never auto-detect or switch languages.`,
        `Write exactly what the speaker says in ${languageName}.`,
        `If the audio contains silence, background noise, music, or speech in a different language, return empty text instead of transliterating it into ${languageName}.`,
        "Keep clear laughter and meaningful emotional vocalizations as natural words such as haha; never describe incidental noise.",
        "Do not translate, answer, explain, summarize, or add a label.",
        `Return only the verbatim ${languageName} transcript.`,
      ].join(" "),
      input_audio_format: "pcm",
      turn_detection: null,
      input_audio_transcription: {
        language,
      },
    },
  };
}

/**
 * This gate never chooses a route. It only verifies that speech matches the
 * source language already locked by the drag direction.
 */
export function createLockedLanguageGateSessionUpdate(): Record<
  string,
  unknown
> {
  return {
    event_id: "event_locked_language_gate",
    type: "session.update",
    session: {
      modalities: ["text"],
      instructions: [
        "You are a strict spoken-language verification gate.",
        "Identify the dominant language actually spoken in the audio without translating or transliterating it.",
        "Return exactly one token: vi for Vietnamese, zh for Chinese, en for English, other for any other spoken language, or none for silence, music, and background noise.",
        "Do not return a transcript, explanation, punctuation, or any additional text.",
      ].join(" "),
      input_audio_format: "pcm",
      turn_detection: null,
    },
  };
}

export function parseSpokenLanguage(value: string): SpokenLanguage {
  const normalized = cleanTranscript(value)
    .toLocaleLowerCase("en")
    .replace(/[^a-z-]+/g, " ")
    .trim();
  if (/^(?:vi|vietnamese)$/.test(normalized)) return "vi";
  if (/^(?:zh|chinese|mandarin|mandarin chinese)$/.test(normalized)) {
    return "zh";
  }
  if (/^(?:en|english)$/.test(normalized)) return "en";
  if (/^(?:none|silence|noise|music|no speech)$/.test(normalized)) {
    return "none";
  }
  return "other";
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

  return transcribePcmSpeech(config, pcm, language);
}

/** Transcribe raw 16 kHz mono PCM16 while keeping the UI-selected language. */
export async function transcribePcmSpeech(
  config: BackendConfig,
  pcm: Buffer,
  language: AgentLanguage,
): Promise<string> {
  if (!pcm.length) {
    throw new TranscriptionError(
      "Bản ghi âm không hợp lệ",
      "ASR_UNAVAILABLE",
    );
  }

  const [detectedLanguage, firstTranscriptValue] = await Promise.all([
    verifyPcmLanguage(config, pcm),
    runRealtimeTranscription(config, pcm, language),
  ]);
  const firstTranscript = cleanTranscript(firstTranscriptValue);
  if (
    detectedLanguage !== language &&
    !isExpressiveVocalization(firstTranscript)
  ) {
    throw new TranscriptionError(
      "Âm thanh không khớp ngôn ngữ đã khóa",
      "EMPTY_SPEECH",
    );
  }
  if (transcriptMatchesLockedLanguage(firstTranscript, language)) {
    return firstTranscript;
  }

  const retryTranscript = cleanTranscript(
    await runRealtimeTranscription(config, pcm, language),
  );
  if (transcriptMatchesLockedLanguage(retryTranscript, language)) {
    return retryTranscript;
  }
  throw new TranscriptionError(
    "Không nghe rõ nội dung trong ngôn ngữ đã chọn, hãy thử nói lại",
    "EMPTY_SPEECH",
  );
}

export function vietnameseTranscriptConfidence(transcript: string): number {
  const markedLetters = transcript.match(
    /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu,
  )?.length ?? 0;
  const commonWords = transcript.match(
    /\b(?:xin|chào|tôi|bạn|hôm|nay|không|có|được|và|là|một)\b/giu,
  )?.length ?? 0;
  return markedLetters * 2 + commonWords;
}

/** Reject cross-script ASR output instead of silently changing language. */
export function transcriptMatchesLockedLanguage(
  transcript: string,
  language: AgentLanguage,
): boolean {
  const trimmed = transcript.trim();
  if (!trimmed) return false;
  const hasHan = /\p{Script=Han}/u.test(trimmed);
  if (language === "zh") {
    return hasHan;
  }
  if (hasHan) return false;
  const hasLetters = /\p{L}/u.test(trimmed);
  if (!hasLetters) return /\p{N}/u.test(trimmed);
  if (isExpressiveVocalization(trimmed)) return true;
  const vietnameseConfidence = vietnameseTranscriptConfidence(trimmed);
  return language === "vi"
    ? vietnameseConfidence >= 2
    : vietnameseConfidence < 2;
}

function isExpressiveVocalization(value: string): boolean {
  const withoutEmoji = value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ")
    .trim();
  return /^(?:(?:ha|he|hi){2,}|h+a+|h+e+|h+i+|ừ+|ờ+|ồ+|ôi+|á+|ơ+|wow+|oops+)[\s.!?,…]*$/iu.test(
    withoutEmoji,
  );
}

function runRealtimeTranscription(
  config: BackendConfig,
  pcm: Buffer,
  language: AgentLanguage,
): Promise<string> {
  return runRealtimeTextTask(
    config,
    pcm,
    createAsrSessionUpdate(language),
    true,
  );
}

async function verifyPcmLanguage(
  config: BackendConfig,
  pcm: Buffer,
): Promise<SpokenLanguage> {
  const result = await runRealtimeTextTask(
    config,
    pcm,
    createLockedLanguageGateSessionUpdate(),
    false,
  );
  return parseSpokenLanguage(result);
}

function runRealtimeTextTask(
  config: BackendConfig,
  pcm: Buffer,
  sessionUpdate: Record<string, unknown>,
  allowInputTranscriptFallback: boolean,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(
      buildQwenRealtimeUrl(config.qwenBaseUrl, config.qwenAsrModel),
      { headers: { Authorization: `Bearer ${config.dashscopeApiKey}` } },
    );
    let settled = false;
    let inputTranscript = "";
    let responseTranscript = "";
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
      else {
        resolve(
          outcome.text ??
            (responseTranscript ||
              (allowInputTranscriptFallback ? inputTranscript : "")),
        );
      }
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
        socket.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["text"] },
          }),
        );
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
          socket.send(JSON.stringify(sessionUpdate));
          break;
        case "session.updated":
          sendNextAudioChunk();
          break;
        case "conversation.item.input_audio_transcription.delta":
          inputTranscript = `${message.text ?? ""}${message.stash ?? ""}`;
          break;
        case "conversation.item.input_audio_transcription.completed":
          inputTranscript = message.transcript ?? inputTranscript;
          break;
        case "response.text.delta":
          responseTranscript += message.delta ?? "";
          break;
        case "response.text.done":
          responseTranscript = message.text || responseTranscript;
          break;
        case "response.done":
          if (message.response?.status === "completed") {
            finish({
              text:
                responseTranscript ||
                (allowInputTranscriptFallback ? inputTranscript : ""),
            });
          } else {
            finish({
              error: new TranscriptionError(
                message.response?.status_details?.reason ||
                  "Không thể nhận dạng giọng nói lúc này",
                "ASR_UNAVAILABLE",
              ),
            });
          }
          break;
        case "conversation.item.input_audio_transcription.failed":
          // The model can still transcribe the audio itself even if its
          // auxiliary auto-transcript fails or chooses the wrong language.
          break;
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
