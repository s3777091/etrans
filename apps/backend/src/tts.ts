import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import { transcribePcmSpeech } from "./agent/transcribe.js";
import { type BackendConfig } from "./config.js";
import { type AgentLanguage } from "./models.js";
import { buildQwenRealtimeUrl } from "./qwen-urls.js";

const TTS_TIMEOUT_MS = 30_000;
const TTS_SAMPLE_RATE = 24_000;
/** How much of the translated wording the audio has to say back. */
const MIN_SPOKEN_WORD_COVERAGE = 0.6;

interface TtsServerEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  response?: {
    status?: string;
    status_details?: { reason?: string };
  };
  error?: { message?: string };
  header?: {
    event?: string;
    error_code?: string;
    error_message?: string;
  };
}

export class SpeechSynthesisError extends Error {
  constructor(
    message: string,
    readonly code: "AUTH_UNAVAILABLE" | "TTS_UNAVAILABLE",
  ) {
    super(message);
    this.name = "SpeechSynthesisError";
  }
}

export function buildQwenTtsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = "wss:";
  if (url.pathname.includes("/compatible-mode/")) {
    url.pathname = "/api-ws/v1/inference";
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function createTtsRunTask(
  taskId: string,
  model: string,
  voice: string,
  language: AgentLanguage,
): Record<string, unknown> {
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      task_group: "audio",
      task: "tts",
      function: "SpeechSynthesizer",
      model,
      parameters: {
        text_type: "PlainText",
        voice,
        format: "pcm",
        sample_rate: TTS_SAMPLE_RATE,
        volume: 50,
        rate: 1,
        pitch: 1,
        enable_ssml: false,
        // System voices accept explicit Chinese/English language hints.
        // Vietnamese is routed through the verified renderer below instead.
        ...(language === "vi" ? {} : { language_hints: [language] }),
      },
      input: {},
    },
  };
}

export async function synthesizeSpeech(
  config: BackendConfig,
  text: string,
  language: AgentLanguage,
  onAudio: (chunk: Buffer) => void,
): Promise<void> {
  if (language === "vi") {
    await synthesizeVerifiedVietnameseSpeech(config, text, onAudio);
    return;
  }
  await synthesizeDedicatedSpeech(config, text, language, onAudio);
}

function synthesizeDedicatedSpeech(
  config: BackendConfig,
  text: string,
  language: AgentLanguage,
  onAudio: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const taskId = randomUUID().replaceAll("-", "");
    const socket = new WebSocket(buildQwenTtsUrl(config.qwenBaseUrl), {
      headers: { Authorization: `Bearer ${config.dashscopeApiKey}` },
    });
    let settled = false;
    let textSent = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, error ? "TTS failed" : "TTS complete");
      }
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(
      () =>
        finish(
          new SpeechSynthesisError(
            "Tạo giọng nói mất quá nhiều thời gian",
            "TTS_UNAVAILABLE",
          ),
        ),
      TTS_TIMEOUT_MS,
    );

    socket.on("open", () => {
      socket.send(
        JSON.stringify(
          createTtsRunTask(
            taskId,
            config.qwenTtsModel,
            config.qwenAudioVoice,
            language,
          ),
        ),
      );
    });

    socket.on("message", (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        const chunk = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        if (chunk.length) onAudio(chunk);
        return;
      }

      let message: TtsServerEvent;
      try {
        message = JSON.parse(raw.toString()) as TtsServerEvent;
      } catch {
        return;
      }
      switch (message.header?.event) {
        case "task-started":
          if (textSent) return;
          textSent = true;
          socket.send(
            JSON.stringify({
              header: {
                action: "continue-task",
                task_id: taskId,
                streaming: "duplex",
              },
              payload: { input: { text } },
            }),
          );
          socket.send(
            JSON.stringify({
              header: {
                action: "finish-task",
                task_id: taskId,
                streaming: "duplex",
              },
              payload: { input: {} },
            }),
          );
          break;
        case "task-finished":
          finish();
          break;
        case "task-failed":
          finish(
            new SpeechSynthesisError(
              message.header.error_message ||
                message.header.error_code ||
                "Không thể tạo giọng nói lúc này",
              "TTS_UNAVAILABLE",
            ),
          );
          break;
      }
    });

    socket.on("unexpected-response", (_request, response) => {
      const authFailure =
        response.statusCode === 401 || response.statusCode === 403;
      finish(
        new SpeechSynthesisError(
          authFailure
            ? "Không thể xác thực dịch vụ giọng nói"
            : "Dịch vụ giọng nói từ chối kết nối",
          authFailure ? "AUTH_UNAVAILABLE" : "TTS_UNAVAILABLE",
        ),
      );
    });
    socket.on("error", () =>
      finish(
        new SpeechSynthesisError(
          "Không thể kết nối dịch vụ giọng nói",
          "TTS_UNAVAILABLE",
        ),
      ),
    );
    socket.on("close", () => {
      if (!settled) {
        finish(
          new SpeechSynthesisError(
            "Dịch vụ giọng nói đóng kết nối quá sớm",
            "TTS_UNAVAILABLE",
          ),
        );
      }
    });
  });
}

async function synthesizeVerifiedVietnameseSpeech(
  config: BackendConfig,
  text: string,
  onAudio: (chunk: Buffer) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = await renderVietnameseSpeech(config, text, attempt > 0);
    if (!spokenTextMatchesExpected(rendered.transcript, text)) continue;
    const pcm = Buffer.concat(rendered.audio);
    try {
      // A second, source-locked ASR pass prevents Chinese-accented or
      // hallucinated audio from reaching the phone even when the renderer's
      // own text transcript looks correct.
      const heard = await transcribePcmSpeech(config, pcm, "vi");
      if (!spokenTextMatchesExpected(heard, text)) continue;
      onAudio(pcm);
      return;
    } catch {
      // Retry once with a stricter rendering instruction.
    }
  }
  throw new SpeechSynthesisError(
    "Âm thanh tiếng Việt không khớp nguyên văn bản dịch nên đã bị chặn",
    "TTS_UNAVAILABLE",
  );
}

function renderVietnameseSpeech(
  config: BackendConfig,
  text: string,
  retry: boolean,
): Promise<{ audio: Buffer[]; transcript: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      buildQwenRealtimeUrl(config.qwenBaseUrl, config.qwenAsrModel),
      { headers: { Authorization: `Bearer ${config.dashscopeApiKey}` } },
    );
    const audio: Buffer[] = [];
    let transcript = "";
    let responseRequested = false;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, error ? "Speech render failed" : "Speech rendered");
      }
      if (error) reject(error);
      else resolve({ audio, transcript });
    };

    const timeout = setTimeout(
      () =>
        finish(
          new SpeechSynthesisError(
            "Tạo giọng tiếng Việt mất quá nhiều thời gian",
            "TTS_UNAVAILABLE",
          ),
        ),
      TTS_TIMEOUT_MS,
    );

    const send = (event: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    };

    socket.on("message", (raw: RawData, isBinary: boolean) => {
      if (isBinary) return;
      let message: TtsServerEvent;
      try {
        message = JSON.parse(raw.toString()) as TtsServerEvent;
      } catch {
        return;
      }
      switch (message.type) {
        case "session.created":
          send({
            type: "session.update",
            session: {
              modalities: ["audio", "text"],
              voice: config.qwenAudioVoice,
              instructions: [
                "You are a Vietnamese text-to-speech renderer, not an assistant or translator.",
                "Read the user's Vietnamese text exactly as written.",
                "Never translate, answer, explain, add, remove, or replace words.",
                "Output only the same Vietnamese sentence in speech.",
                retry
                  ? "A previous reading failed exact-text verification; pronounce every Vietnamese word carefully."
                  : "Use clear native Vietnamese pronunciation.",
              ].join(" "),
              turn_detection: null,
              max_history_turns: 1,
              input_audio_format: "pcm",
              output_audio_format: "pcm",
            },
          });
          break;
        case "session.updated":
          send({
            type: "conversation.item.create",
            item: {
              id: `vietnamese_tts_${randomUUID().replaceAll("-", "")}`,
              type: "message",
              role: "user",
              content: [{ type: "input_text", text }],
            },
          });
          break;
        case "conversation.item.created":
          if (!responseRequested) {
            responseRequested = true;
            send({
              type: "response.create",
              response: { modalities: ["audio", "text"] },
            });
          }
          break;
        case "response.audio.delta":
          if (message.delta) {
            audio.push(Buffer.from(message.delta, "base64"));
          }
          break;
        case "response.audio_transcript.delta":
          transcript += message.delta ?? "";
          break;
        case "response.audio_transcript.done":
          transcript = message.transcript || transcript;
          break;
        case "response.done":
          if (message.response?.status === "completed" && audio.length) {
            finish();
          } else {
            finish(
              new SpeechSynthesisError(
                message.response?.status_details?.reason ||
                  "Không thể tạo giọng tiếng Việt",
                "TTS_UNAVAILABLE",
              ),
            );
          }
          break;
        case "error":
          finish(
            new SpeechSynthesisError(
              message.error?.message || "Không thể tạo giọng tiếng Việt",
              "TTS_UNAVAILABLE",
            ),
          );
          break;
      }
    });

    socket.on("unexpected-response", (_request, response) => {
      const authFailure =
        response.statusCode === 401 || response.statusCode === 403;
      finish(
        new SpeechSynthesisError(
          authFailure
            ? "Không thể xác thực dịch vụ giọng nói"
            : "Dịch vụ giọng nói từ chối kết nối",
          authFailure ? "AUTH_UNAVAILABLE" : "TTS_UNAVAILABLE",
        ),
      );
    });
    socket.on("error", () =>
      finish(
        new SpeechSynthesisError(
          "Không thể kết nối dịch vụ giọng nói",
          "TTS_UNAVAILABLE",
        ),
      ),
    );
    socket.on("close", () => {
      if (!settled) {
        finish(
          new SpeechSynthesisError(
            "Dịch vụ giọng nói đóng kết nối quá sớm",
            "TTS_UNAVAILABLE",
          ),
        );
      }
    });
  });
}

/**
 * Speech and text never spell numbers the same way: the renderer reads "250"
 * as "hai trăm năm mươi", and the verifying pass writes those words back. A
 * verbatim comparison therefore silenced every translation carrying a digit,
 * a unit, or an abbreviation. What the gate is actually for — keeping Chinese,
 * Chinese-accented, or invented audio off the phone — survives a comparison on
 * the words themselves.
 */
export function spokenTextMatchesExpected(
  spoken: string,
  expected: string,
): boolean {
  if (/\p{Script=Han}/u.test(spoken)) return false;
  const spokenWords = spokenWordsOf(spoken);
  const expectedWords = spokenWordsOf(expected);
  if (!spokenWords.length || !expectedWords.length) return false;

  // Digits are pronounced, never spelled, so only the words around them can
  // prove the reading belongs to this translation.
  const expectedLexical = expectedWords.filter((word) => /\p{L}/u.test(word));
  if (!expectedLexical.length) return true;

  const available = new Map<string, number>();
  for (const word of spokenWords) {
    available.set(word, (available.get(word) ?? 0) + 1);
  }
  let matched = 0;
  for (const word of expectedLexical) {
    const remaining = available.get(word) ?? 0;
    if (remaining > 0) {
      available.set(word, remaining - 1);
      matched += 1;
    }
  }

  // Spoken numbers expand into several words each, so the reading is allowed
  // to run longer than the text — but not far enough to hide a whole invented
  // sentence appended to it.
  return (
    spokenWords.length <= expectedWords.length * 3 + 6 &&
    matched / expectedLexical.length >= MIN_SPOKEN_WORD_COVERAGE
  );
}

function spokenWordsOf(value: string): string[] {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
