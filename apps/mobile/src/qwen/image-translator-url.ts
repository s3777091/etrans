export function buildImageTranslationUrl(apiBaseUrl: string): string {
  return new URL(
    "/v1/qwen/image-translate",
    apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`,
  ).toString();
}
