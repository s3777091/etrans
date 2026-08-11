import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket from "ws";

import { type BackendConfig } from "./config.js";
import {
  isAgentLanguage,
  isInterpreterDirection,
  isTextTranslationModel,
  isVoiceTranslationModel,
  type AgentLanguage,
  type InterpreterDirection,
} from "./models.js";
import {
  runAgentTurn,
  sanitizeAgentRequest,
  type AgentEvent,
} from "./agent/agent.js";
import {
  MAX_AUDIO_DATA_URL_LENGTH,
  TranscriptionError,
  isSupportedAudioDataUrl,
  transcribeSpeech,
} from "./agent/transcribe.js";
import {
  buildQwenChatCompletionsUrl,
  buildQwenRealtimeUrl,
} from "./qwen-urls.js";
import {
  clientEventsForAudioTranslation,
  parseRealtimeEvent,
  serverEventsForAudioTranslation,
} from "./live-translation.js";

export {
  buildQwenChatCompletionsUrl,
  buildQwenRealtimeUrl,
} from "./qwen-urls.js";

interface LiveQuery {
  direction?: string;
  model?: string;
}

interface ImageTranslateBody {
  imageDataUrl?: string;
  languagePair?: string;
  translationModel?: string;
  translationPrompt?: string;
}

interface TranscribeBody {
  audioDataUrl?: string;
  language?: string;
}

interface QwenChatCompletion {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
}

export type LanguagePair = "vi-zh" | "vi-en";
export type ImageSourceLanguage = "vi" | "zh" | "en" | "other";
export type ImageTargetLanguage = "vi" | "zh" | "en";

interface ImageOcrResult {
  sourceLanguage: ImageSourceLanguage;
  text: string;
}

interface QueuedMessage {
  data: string;
}

const MAX_QUEUED_MESSAGES = 256;
const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;
const IMAGE_TRANSLATION_TIMEOUT_MS = 20_000;

export async function createServer(config: BackendConfig) {
  const server = Fastify({
    logger: {
      redact: ["req.headers.authorization", "*.token", "*.apiKey"],
    },
  });

  await server.register(cors, { origin: false });
  await server.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });
  // Agent turns carry a photo inside a single frame, so the default payload
  // ceiling has to leave room for a compressed JPEG data URL.
  await server.register(fastifyWebsocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
  });

  server.get("/healthz", async () => ({
    ok: true,
    provider: "qwen",
    model: config.qwenAsrModel,
    protocol: "qwen-audio-translation",
  }));

  server.post<{ Body: ImageTranslateBody }>(
    "/v1/qwen/image-translate",
    {
      bodyLimit: MAX_IMAGE_DATA_URL_LENGTH + 16_384,
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const imageDataUrl = request.body?.imageDataUrl?.trim() ?? "";
      if (!isSupportedImageDataUrl(imageDataUrl)) {
        return reply.code(400).send({
          error: "INVALID_IMAGE",
          message: "Expected a JPEG, PNG, or WebP data URL under 6 MB",
        });
      }

      const languagePair: LanguagePair =
        request.body?.languagePair === "vi-en" ? "vi-en" : "vi-zh";
      const requestedTranslationModel =
        request.body?.translationModel?.trim() ?? "";
      if (
        requestedTranslationModel &&
        !isTextTranslationModel(requestedTranslationModel)
      ) {
        return reply.code(400).send({
          error: "INVALID_TRANSLATION_MODEL",
          message: "Model dịch không được hỗ trợ",
        });
      }
      // Honour the model chosen in the app; the OCR step stays pinned to the
      // configured vision model because not every chat model can read images.
      const translationModel =
        requestedTranslationModel || config.qwenImageTranslationModel;
      const translationPrompt =
        typeof request.body?.translationPrompt === "string"
          ? request.body.translationPrompt.trim().slice(0, 800)
          : "";

      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        IMAGE_TRANSLATION_TIMEOUT_MS,
      );
      try {
        const completionsUrl = buildQwenChatCompletionsUrl(
          config.qwenBaseUrl,
        );
        const headers = {
          Authorization: `Bearer ${config.dashscopeApiKey}`,
          "Content-Type": "application/json",
        };
        const ocrResponse = await fetch(
          completionsUrl,
          {
            method: "POST",
            headers,
            body: JSON.stringify(
              createImageOcrPayload(
                imageDataUrl,
                config.qwenImageOcrModel,
                languagePair,
              ),
            ),
            signal: abortController.signal,
          },
        );

        if (!ocrResponse.ok) {
          request.log.warn(
            { statusCode: ocrResponse.status },
            "Qwen image OCR was rejected",
          );
          return reply.code(503).send({
            error:
              ocrResponse.status === 401 || ocrResponse.status === 403
                ? "AUTH_UNAVAILABLE"
                : "IMAGE_OCR_UNAVAILABLE",
            message: "Không thể dịch ảnh lúc này",
          });
        }

        const ocrCompletion = (await ocrResponse.json()) as QwenChatCompletion;
        const ocrResult = parseImageOcrResult(
          readCompletionText(ocrCompletion),
        );
        if (!ocrResult) {
          return reply.code(502).send({
            error: "EMPTY_IMAGE_TEXT",
            message: "Không tìm thấy chữ rõ ràng trong ảnh",
          });
        }

        const targetLanguage = targetLanguageForImageSource(
          ocrResult.sourceLanguage,
          languagePair,
        );
        const translationResponse = await fetch(completionsUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(
            createMachineTranslationPayload(
              ocrResult.text,
              targetLanguage,
              translationModel,
              translationPrompt,
            ),
          ),
          signal: abortController.signal,
        });

        if (!translationResponse.ok) {
          request.log.warn(
            { statusCode: translationResponse.status },
            "Qwen machine translation was rejected",
          );
          return reply.code(503).send({
            error:
              translationResponse.status === 401 ||
              translationResponse.status === 403
                ? "AUTH_UNAVAILABLE"
                : "IMAGE_TRANSLATION_UNAVAILABLE",
            message: "Không thể dịch ảnh lúc này",
          });
        }

        const translationCompletion =
          (await translationResponse.json()) as QwenChatCompletion;
        const translation = readCompletionText(translationCompletion).trim();
        if (!translation) {
          return reply.code(502).send({
            error: "EMPTY_IMAGE_TRANSLATION",
            message: "Không thể tạo bản dịch từ ảnh",
          });
        }

        reply.header("Cache-Control", "no-store");
        return {
          sourceLanguage: ocrResult.sourceLanguage,
          targetLanguage,
          sourceText: ocrResult.text,
          translation,
        };
      } catch (error) {
        request.log.warn({ err: error }, "Qwen image translation failed");
        return reply.code(503).send({
          error: "IMAGE_TRANSLATION_UNAVAILABLE",
          message: "Không thể dịch ảnh lúc này",
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  server.get<{ Querystring: LiveQuery }>(
    "/v1/qwen/live",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const direction = request.query.direction?.trim() ?? "";
        if (!isInterpreterDirection(direction)) {
          return reply.code(400).send({
            error: "INVALID_DIRECTION",
            message: "Direction is not supported",
          });
        }
        const requestedModel = request.query.model?.trim() ?? "";
        if (requestedModel && !isVoiceTranslationModel(requestedModel)) {
          return reply.code(400).send({
            error: "INVALID_VOICE_MODEL",
            message: "Voice translation model is not supported",
          });
        }
      },
    },
    (socket, request) => {
      const direction = request.query.direction as InterpreterDirection;
      const upstream = new WebSocket(
        buildQwenRealtimeUrl(config.qwenBaseUrl, config.qwenAsrModel),
        {
          headers: {
            Authorization: `Bearer ${config.dashscopeApiKey}`,
          },
        },
      );
      const pending: QueuedMessage[] = [];
      let closed = false;

      const closeBoth = (code = 1000, reason = "Session closed") => {
        if (closed) return;
        closed = true;
        closeSocket(socket, code, reason);
        closeSocket(upstream, code, reason);
      };

      const sendUpstream = (data: string) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data);
        } else if (pending.length >= MAX_QUEUED_MESSAGES) {
          closeBoth(1009, "Too many queued audio messages");
        } else {
          pending.push({ data });
        }
      };

      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          closeBoth(1003, "Expected JSON audio events");
          return;
        }
        const message = parseRealtimeEvent(data.toString());
        if (!message) {
          closeBoth(1003, "Invalid realtime event");
          return;
        }
        for (const event of clientEventsForAudioTranslation(
          message,
          direction,
          config.qwenAudioVoice,
        )) {
          sendUpstream(JSON.stringify(event));
        }
      });

      upstream.on("open", () => {
        for (const message of pending.splice(0)) {
          upstream.send(message.data);
        }
      });

      upstream.on("message", (data) => {
        const message = parseRealtimeEvent(data.toString());
        if (!message) {
          request.log.warn("Qwen returned an invalid realtime event");
          sendProxyError(socket, "SERVICE_UNAVAILABLE");
          closeBoth(1011, "Invalid Qwen event");
          return;
        }
        for (const event of serverEventsForAudioTranslation(message)) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        }
      });

      upstream.on("unexpected-response", (_upstreamRequest, response) => {
        request.log.warn(
          { statusCode: response.statusCode },
          "Qwen realtime connection was rejected",
        );
        const errorCode =
          response.statusCode === 401 || response.statusCode === 403
            ? "AUTH_UNAVAILABLE"
            : "SERVICE_UNAVAILABLE";
        sendProxyError(socket, errorCode);
        closeBoth(1011, errorCode);
      });

      upstream.on("error", (error) => {
        request.log.warn({ err: error }, "Qwen realtime connection failed");
        sendProxyError(socket, "SERVICE_UNAVAILABLE");
        closeBoth(1011, "Qwen connection failed");
      });

      upstream.on("close", (code, reason) => {
        closeBoth(normalizeCloseCode(code), safeReason(reason.toString()));
      });
      socket.on("close", () => closeBoth());
      socket.on("error", () => closeBoth(1011, "Client connection failed"));
    },
  );

  server.post<{ Body: TranscribeBody }>(
    "/v1/agent/transcribe",
    {
      bodyLimit: MAX_AUDIO_DATA_URL_LENGTH + 16_384,
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const audioDataUrl = request.body?.audioDataUrl?.trim() ?? "";
      if (!isSupportedAudioDataUrl(audioDataUrl)) {
        return reply.code(400).send({
          error: "INVALID_AUDIO",
          message: "Expected a base64 audio data URL under 8 MB",
        });
      }

      const requestedLanguage = request.body?.language?.trim() ?? "";
      const language: AgentLanguage = isAgentLanguage(requestedLanguage)
        ? requestedLanguage
        : "vi";

      try {
        const text = await transcribeSpeech(config, audioDataUrl, language);
        reply.header("Cache-Control", "no-store");
        return { text };
      } catch (error) {
        if (error instanceof TranscriptionError) {
          request.log.warn({ code: error.code }, "Qwen transcription failed");
          return reply
            .code(error.code === "EMPTY_SPEECH" ? 422 : 503)
            .send({ error: error.code, message: error.message });
        }
        request.log.warn({ err: error }, "Qwen transcription failed");
        return reply.code(503).send({
          error: "ASR_UNAVAILABLE",
          message: "Không thể nhận dạng giọng nói lúc này",
        });
      }
    },
  );

  server.get(
    "/v1/agent/chat",
    { websocket: true },
    (socket, request) => {
      let running: AbortController | undefined;

      // The turn id travels back on every event so the phone can drop what an
      // interrupted turn is still emitting.
      const send = (event: AgentEvent, turnId?: string) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(turnId ? { ...event, turnId } : event));
        }
      };

      socket.on("message", (raw) => {
        let payload: { type?: string; turnId?: unknown } | undefined;
        try {
          payload = JSON.parse(raw.toString()) as {
            type?: string;
            turnId?: unknown;
          };
        } catch {
          send({
            type: "agent.error",
            code: "PROTOCOL_ERROR",
            message: "Yêu cầu không hợp lệ",
          });
          return;
        }

        if (payload?.type === "agent.cancel") {
          running?.abort();
          return;
        }
        if (payload?.type !== "agent.turn") return;

        const turnId =
          typeof payload.turnId === "string"
            ? payload.turnId.slice(0, 120)
            : undefined;
        const turn = sanitizeAgentRequest(payload, config.qwenAgentModel);
        if (!turn) {
          send(
            {
              type: "agent.error",
              code: "INVALID_REQUEST",
              message: "Nội dung tin nhắn không hợp lệ",
            },
            turnId,
          );
          return;
        }

        // A new turn always wins: the phone only sends one after the user has
        // interrupted whatever was streaming.
        running?.abort();

        const controller = new AbortController();
        running = controller;
        void runAgentTurn(
          config,
          turn,
          (event) => send(event, turnId),
          controller.signal,
        )
          .catch((error: unknown) => {
            request.log.warn({ err: error }, "Agent turn failed");
            send(
              {
                type: "agent.error",
                code: "AGENT_UNAVAILABLE",
                message: "Không thể kết nối trợ lý lúc này",
              },
              turnId,
            );
          })
          .finally(() => {
            if (running === controller) running = undefined;
          });
      });

      socket.on("close", () => running?.abort());
      socket.on("error", () => running?.abort());
    },
  );

  return server;
}

export function createImageOcrPayload(
  imageDataUrl: string,
  model: string,
  languagePair: LanguagePair = "vi-zh",
): Record<string, unknown> {
  const counterpart = languagePair === "vi-zh" ? "Chinese" : "English";
  const payload: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          {
            type: "text",
            text: [
              "Extract all readable text from this image in its original language.",
              `The configured translation pair is Vietnamese and ${counterpart}.`,
              "Detect the dominant source language as vi for Vietnamese, zh for Simplified or Traditional Chinese, en for English, or other.",
              "Preserve line order, names, numbers, prices, and units.",
              "Return only valid JSON in this exact shape: {\"sourceLanguage\":\"vi|zh|en|other\",\"text\":\"extracted text\"}.",
              "If there is no readable text, set text to an empty string.",
            ].join(" "),
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 2_400,
    stream: false,
  };
  if (isHybridThinkingVisionModel(model)) {
    payload.enable_thinking = false;
    payload.response_format = { type: "json_object" };
  }
  return payload;
}

export function createMachineTranslationPayload(
  text: string,
  targetLanguage: ImageTargetLanguage,
  model: string,
  prompt = "",
): Record<string, unknown> {
  const targetNames: Record<ImageTargetLanguage, string> = {
    vi: "Vietnamese",
    zh: "Chinese",
    en: "English",
  };
  if (model.startsWith("qwen-mt-")) {
    return {
      model,
      messages: [{ role: "user", content: text }],
      translation_options: {
        source_lang: "auto",
        target_lang: targetNames[targetLanguage],
        ...(prompt ? { domains: prompt } : {}),
      },
      stream: false,
    };
  }

  const instructions = [
    `Translate the following text into ${targetNames[targetLanguage]}.`,
    "Preserve names, numbers, prices, units, punctuation, and line breaks.",
    "Return only the translation, without notes or explanations.",
    ...(prompt ? [`Additional translation requirements: ${prompt}`] : []),
    "",
    text,
  ].join("\n");
  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: instructions }],
    stream: false,
  };
  if (isHybridThinkingVisionModel(model)) {
    payload.enable_thinking = false;
  }
  return payload;
}

function isHybridThinkingVisionModel(model: string): boolean {
  return /^qwen3\.(?:5|6|7)(?:-|$)/i.test(model);
}

export function targetLanguageForImageSource(
  sourceLanguage: ImageSourceLanguage,
  languagePair: LanguagePair = "vi-zh",
): ImageTargetLanguage {
  const counterpart = languagePair === "vi-zh" ? "zh" : "en";
  return sourceLanguage === "vi" ? counterpart : "vi";
}

export function parseImageOcrResult(value: string): ImageOcrResult | undefined {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned || /no readable text|không tìm thấy chữ/i.test(cleaned)) {
    return undefined;
  }

  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      const parsed = JSON.parse(
        cleaned.slice(objectStart, objectEnd + 1),
      ) as { sourceLanguage?: unknown; text?: unknown };
      const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      if (!text) return undefined;
      return {
        sourceLanguage: normalizeImageSourceLanguage(
          parsed.sourceLanguage,
          text,
        ),
        text,
      };
    } catch {
      // Fall through to the plain-text recovery path below.
    }
  }

  return {
    sourceLanguage: detectImageSourceLanguage(cleaned),
    text: cleaned,
  };
}

function normalizeImageSourceLanguage(
  value: unknown,
  text: string,
): ImageSourceLanguage {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "vi" || normalized === "vietnamese") return "vi";
    if (
      normalized === "zh" ||
      normalized === "chinese" ||
      normalized === "zh-cn" ||
      normalized === "zh-tw"
    ) {
      return "zh";
    }
    if (normalized === "en" || normalized === "english") return "en";
    if (normalized === "other") return "other";
  }
  return detectImageSourceLanguage(text);
}

function detectImageSourceLanguage(text: string): ImageSourceLanguage {
  if (/[\u3400-\u4DBF\u4E00-\u9FFF]/u.test(text)) return "zh";
  if (
    /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(
      text,
    ) ||
    /\b(và|của|là|không|một|những|được|tiếng|dịch)\b/iu.test(text)
  ) {
    return "vi";
  }
  if (/[A-Za-z]{2}/u.test(text)) return "en";
  return "other";
}

function readCompletionText(completion: QwenChatCompletion): string {
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function isSupportedImageDataUrl(value: string): boolean {
  return (
    value.length > 32 &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
  );
}

function sendProxyError(socket: WebSocket, code: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: "proxy.error",
      error: {
        code,
        message: "Không thể kết nối dịch vụ Qwen",
      },
    }),
  );
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close(code, reason.slice(0, 123));
  }
}

function normalizeCloseCode(code: number): number {
  return code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006
    ? code
    : 1011;
}

function safeReason(reason: string): string {
  return reason && reason.length <= 123 ? reason : "Qwen session closed";
}
