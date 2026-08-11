import { arrayBufferToBase64 } from "../qwen/base64";
import type { AgentLanguage } from "../settings/agent-settings";

const TRANSCRIBE_TIMEOUT_MS = 45_000;

interface TranscribeResponse {
  text?: string;
  error?: string;
  message?: string;
}

export function buildTranscribeUrl(apiBaseUrl: string): string {
  return new URL(
    "/v1/agent/transcribe",
    apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`,
  ).toString();
}

export function wavDataUrl(wav: ArrayBuffer): string {
  return `data:audio/wav;base64,${arrayBufferToBase64(wav)}`;
}

export async function transcribeRecording(
  apiBaseUrl: string,
  wav: ArrayBuffer,
  language: AgentLanguage,
): Promise<string> {
  // The server gives up after 30 s; without a client deadline a dead network
  // would leave the orb spinning on "đang chuyển giọng nói" forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildTranscribeUrl(apiBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioDataUrl: wavDataUrl(wav), language }),
      signal: controller.signal,
    });
  } catch {
    throw new Error("Không thể kết nối máy chủ để nhận dạng giọng nói");
  } finally {
    clearTimeout(timeout);
  }

  const result = (await response.json().catch(() => ({}))) as TranscribeResponse;
  if (!response.ok || !result.text?.trim()) {
    throw new Error(result.message || "Không thể nhận dạng giọng nói lúc này");
  }
  return result.text.trim();
}
