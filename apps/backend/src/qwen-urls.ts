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
