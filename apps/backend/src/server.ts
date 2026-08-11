import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket, { type RawData } from "ws";

import { type BackendConfig } from "./config.js";
import {
  isInterpreterDirection,
  isTextTranslationModel,
  isVoiceTranslationModel,
} from "./models.js";

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
  data: RawData;
  isBinary: boolean;
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
  await server.register(fastifyWebsocket);

  server.get("/healthz", async () => ({
    ok: true,
    provider: "qwen",
    model: config.qwenLiveModel,
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
      const translationModel = config.qwenImageTranslationModel;
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
      const model = request.query.model?.trim() || config.qwenLiveModel;
      const upstream = new WebSocket(
        buildQwenRealtimeUrl(config.qwenBaseUrl, model),
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

      socket.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
          return;
        }
        if (pending.length >= MAX_QUEUED_MESSAGES) {
          closeBoth(1009, "Too many queued audio messages");
          return;
        }
        pending.push({ data, isBinary });
      });

      upstream.on("open", () => {
        for (const message of pending.splice(0)) {
          upstream.send(message.data, { binary: message.isBinary });
        }
      });

      upstream.on("message", (data, isBinary) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data, { binary: isBinary });
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

  return server;
}

export function buildQwenRealtimeUrl(baseUrl: string, model: string): string {
  const url = new URL(baseUrl);
  url.protocol = "wss:";
  if (url.pathname.includes("/compatible-mode/")) {
    url.pathname = "/api-ws/v1/realtime";
  }
  url.search = "";
  url.hash = "";
  url.searchParams.set("model", model);
  return url.toString();
}

export function buildQwenChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = "https:";
  if (url.pathname.includes("/api-ws/")) {
    url.pathname = "/compatible-mode/v1";
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
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
