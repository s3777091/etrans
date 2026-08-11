import { describe, expect, it } from "vitest";

import { buildImageTranslationUrl } from "./image-translator-url";

describe("image translator", () => {
  it("builds the protected backend endpoint", () => {
    expect(buildImageTranslationUrl("https://example.com/api")).toBe(
      "https://example.com/v1/qwen/image-translate",
    );
  });
});
