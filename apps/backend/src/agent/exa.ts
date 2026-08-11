const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 8;
const MAX_TEXT_CHARACTERS = 1_200;
const SEARCH_TIMEOUT_MS = 15_000;

export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  text: string;
}

interface ExaSearchResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    publishedDate?: unknown;
    text?: unknown;
    summary?: unknown;
    highlights?: unknown;
  }>;
}

export class ExaSearchError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ExaSearchError";
  }
}

export async function searchExa(
  apiKey: string,
  query: string,
  numResults = DEFAULT_RESULTS,
  signal?: AbortSignal,
): Promise<ExaSearchResult[]> {
  if (!apiKey) {
    throw new ExaSearchError("Exa API key is not configured");
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    SEARCH_TIMEOUT_MS,
  );
  const abortUpstream = () => timeoutController.abort();
  signal?.addEventListener("abort", abortUpstream);

  try {
    const response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildExaSearchPayload(query, numResults)),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new ExaSearchError(
        `Exa search failed with status ${response.status}`,
        response.status,
      );
    }

    return parseExaResponse(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortUpstream);
  }
}

export function buildExaSearchPayload(
  query: string,
  numResults = DEFAULT_RESULTS,
): Record<string, unknown> {
  return {
    query: query.trim().slice(0, 400),
    numResults: clampResults(numResults),
    type: "auto",
    contents: {
      text: { maxCharacters: MAX_TEXT_CHARACTERS, verbosity: "compact" },
    },
  };
}

export function parseExaResponse(payload: unknown): ExaSearchResult[] {
  const results = (payload as ExaSearchResponse | null)?.results;
  if (!Array.isArray(results)) return [];

  const parsed: ExaSearchResult[] = [];
  for (const result of results) {
    const url = typeof result.url === "string" ? result.url.trim() : "";
    if (!url) continue;
    parsed.push({
      title:
        typeof result.title === "string" && result.title.trim()
          ? result.title.trim()
          : url,
      url,
      publishedDate:
        typeof result.publishedDate === "string" && result.publishedDate
          ? result.publishedDate
          : undefined,
      text: readResultText(result).slice(0, MAX_TEXT_CHARACTERS),
    });
  }
  return parsed.slice(0, MAX_RESULTS);
}

/** The model reads this text, so keep the numbering stable for citations. */
export function formatExaResults(results: ExaSearchResult[]): string {
  if (results.length === 0) {
    return "No search results were found for this query.";
  }
  return results
    .map((result, index) => {
      const published = result.publishedDate
        ? `\nPublished: ${result.publishedDate}`
        : "";
      return [
        `[${index + 1}] ${result.title}`,
        `URL: ${result.url}${published}`,
        result.text || "(no page text available)",
      ].join("\n");
    })
    .join("\n\n");
}

function readResultText(result: {
  text?: unknown;
  summary?: unknown;
  highlights?: unknown;
}): string {
  if (typeof result.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  if (typeof result.summary === "string" && result.summary.trim()) {
    return result.summary.trim();
  }
  if (Array.isArray(result.highlights)) {
    return result.highlights
      .filter((highlight): highlight is string => typeof highlight === "string")
      .join(" … ")
      .trim();
  }
  return "";
}

function clampResults(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(value)));
}
