import type {
  QwenLiveError,
  QwenLiveErrorCode,
  QwenLiveErrorScope,
} from "./types";

interface ErrorOptions {
  message: string;
  code?: QwenLiveErrorCode;
  scope?: QwenLiveErrorScope;
  retryable?: boolean;
  closeCode?: number;
}

export function createQwenLiveError(options: ErrorOptions): QwenLiveError {
  const error = new Error(options.message) as QwenLiveError;
  error.name = "QwenLiveError";
  error.code = options.code ?? "UNKNOWN";
  error.scope = options.scope ?? "unknown";
  error.retryable = options.retryable ?? false;
  error.closeCode = options.closeCode;
  return error;
}

export function classifyQwenError(
  message: string,
  closeCode?: number,
): QwenLiveError {
  const normalized = message.toUpperCase();

  if (
    normalized.includes("AUTH") ||
    normalized.includes("API KEY") ||
    normalized.includes("INVALIDAPIKEY") ||
    normalized.includes("401") ||
    normalized.includes("BALANCE") ||
    normalized.includes("ARREARS")
  ) {
    return createQwenLiveError({
      message,
      code: "AUTH_UNAVAILABLE",
      scope: "account",
      retryable: false,
      closeCode,
    });
  }

  // Qwen retires realtime models without notice; the session then closes with
  // "Model not exist." and retrying forever would never recover.
  if (
    normalized.includes("MODEL NOT EXIST") ||
    normalized.includes("MODEL NOT FOUND") ||
    normalized.includes("MODEL_NOT_FOUND") ||
    normalized.includes("DOES NOT EXIST")
  ) {
    return createQwenLiveError({
      message,
      code: "MODEL_UNAVAILABLE",
      scope: "service",
      retryable: false,
      closeCode,
    });
  }

  if (
    normalized.includes("NETWORK") ||
    normalized.includes("SOCKET") ||
    normalized.includes("CONNECTION") ||
    normalized.includes("TIMEOUT") ||
    closeCode === 1006
  ) {
    return createQwenLiveError({
      message,
      code: "NETWORK_ERROR",
      scope: "network",
      retryable: true,
      closeCode,
    });
  }

  if (
    normalized.includes("SERVICE") ||
    normalized.includes("RATE") ||
    normalized.includes("CAPACITY") ||
    normalized.includes("429") ||
    normalized.includes("500") ||
    normalized.includes("503")
  ) {
    return createQwenLiveError({
      message,
      code: "SERVICE_UNAVAILABLE",
      scope: "service",
      retryable: true,
      closeCode,
    });
  }

  return createQwenLiveError({ message, closeCode });
}
