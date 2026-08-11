import { describe, expect, it } from "vitest";

import {
  buildQwenTtsUrl,
  createTtsRunTask,
  spokenTextMatchesExpected,
} from "./tts.js";

describe("dedicated Qwen TTS", () => {
  it("uses the inference endpoint instead of the conversational realtime URL", () => {
    expect(
      buildQwenTtsUrl(
        "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      ),
    ).toBe(
      "wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference",
    );
  });

  it("locks synthesis to the translation target language", () => {
    expect(
      createTtsRunTask(
        "task-id",
        "qwen-audio-3.0-tts-plus",
        "longanlingxin",
        "zh",
      ),
    ).toMatchObject({
      header: { action: "run-task", task_id: "task-id" },
      payload: {
        task: "tts",
        model: "qwen-audio-3.0-tts-plus",
        parameters: {
          format: "pcm",
          sample_rate: 24_000,
          language_hints: ["zh"],
        },
      },
    });
  });

  it("does not send unsupported Vietnamese hints to dedicated TTS", () => {
    const task = createTtsRunTask(
      "task-id",
      "qwen-audio-3.0-tts-plus",
      "longanlingxin",
      "vi",
    ) as { payload: { parameters: Record<string, unknown> } };
    expect(task.payload.parameters).not.toHaveProperty("language_hints");
  });

  it("accepts a reading of the same Vietnamese sentence", () => {
    expect(
      spokenTextMatchesExpected(
        "Xin chào, hôm nay bạn thế nào?",
        "Xin chào hôm nay bạn thế nào.",
      ),
    ).toBe(true);
  });

  it("accepts numbers and units the voice spells out", () => {
    expect(
      spokenTextMatchesExpected(
        "Giá là hai trăm năm mươi nghìn đồng.",
        "Giá là 250 nghìn đồng.",
      ),
    ).toBe(true);
    expect(
      spokenTextMatchesExpected(
        "Khách sạn cách đây khoảng ba ki lô mét.",
        "Khách sạn cách đây khoảng 3 km.",
      ),
    ).toBe(true);
  });

  it("still blocks Chinese, silence, and invented speech", () => {
    expect(spokenTextMatchesExpected("你好。Xin chào.", "Xin chào.")).toBe(
      false,
    );
    expect(spokenTextMatchesExpected("", "Xin chào.")).toBe(false);
    expect(
      spokenTextMatchesExpected(
        "Tôi không thể giúp bạn việc đó.",
        "Giá là 250 nghìn đồng.",
      ),
    ).toBe(false);
    expect(
      spokenTextMatchesExpected(
        "Xin chào bạn. Tôi là trợ lý ảo, tôi có thể giúp gì cho bạn hôm nay không, bạn cần tôi hỗ trợ điều gì?",
        "Xin chào bạn.",
      ),
    ).toBe(false);
  });
});
