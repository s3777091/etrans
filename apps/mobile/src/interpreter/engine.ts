import { PcmJitterPlayer } from "../audio/pcm-player";
import { QwenLiveTranslateAdapter } from "../qwen/live-adapter";
import {
  QWEN_LIVE_MODEL,
  type InterpreterDirection,
  type QwenLiveError,
  type VoiceTranslationModel,
} from "../qwen/types";

export interface InterpreterMetrics {
  provider: "Alibaba Qwen";
  currentModel: VoiceTranslationModel;
  mode: "REALTIME";
  direction: InterpreterDirection;
  websocketRttMs?: number;
  firstInputTranscriptMs?: number;
  firstTranslatedTranscriptMs?: number;
  firstTranslatedAudioMs?: number;
  pcmQueueMs: number;
  droppedBuffers: number;
}

type MetricsCallback = (metrics: InterpreterMetrics) => void;
type TranscriptCallback = (
  kind: "input" | "output",
  text: string,
  direction: InterpreterDirection,
) => void;

export class LiveInterpreterEngine {
  private adapter: QwenLiveTranslateAdapter | undefined;
  private readonly player: PcmJitterPlayer;
  private direction: InterpreterDirection = "zh-to-vi";
  private model: VoiceTranslationModel = QWEN_LIVE_MODEL;
  private prepareQueue: Promise<void> = Promise.resolve();
  private turnStartedAt = 0;
  private metrics: InterpreterMetrics;
  private readonly metricsCallbacks = new Set<MetricsCallback>();
  private readonly transcriptCallbacks = new Set<TranscriptCallback>();
  private readonly errorCallbacks = new Set<(error: QwenLiveError) => void>();
  private readonly turnCompleteCallbacks = new Set<() => void>();

  constructor(private readonly apiBaseUrl: string) {
    this.metrics = {
      provider: "Alibaba Qwen",
      currentModel: QWEN_LIVE_MODEL,
      mode: "REALTIME",
      direction: this.direction,
      pcmQueueMs: 0,
      droppedBuffers: 0,
    };
    this.player = new PcmJitterPlayer((pcmQueueMs) => {
      this.updateMetrics({ pcmQueueMs });
    });
  }

  async connectWarm(
    direction: InterpreterDirection = this.direction,
    model: VoiceTranslationModel = this.model,
  ): Promise<void> {
    await this.prepare(direction, model);
  }

  prepare(
    direction: InterpreterDirection,
    model: VoiceTranslationModel = this.model,
  ): Promise<void> {
    const operation = this.prepareQueue.then(async () => {
      if (
        !this.adapter ||
        direction !== this.direction ||
        model !== this.model
      ) {
        this.player.clear();
        await this.adapter?.disconnect();
        this.direction = direction;
        this.model = model;
        const adapter = new QwenLiveTranslateAdapter(
          this.apiBaseUrl,
          direction,
          model,
        );
        this.adapter = adapter;
        this.bindAdapter(adapter);
      }
      await this.adapter.connect();
      this.updateMetrics({
        direction,
        currentModel: model,
        websocketRttMs: this.adapter.getWebSocketRtt(),
      });
    });

    this.prepareQueue = operation.catch(() => undefined);
    return operation;
  }

  async beginTurn(
    direction: InterpreterDirection,
    model: VoiceTranslationModel = this.model,
  ): Promise<void> {
    await this.prepare(direction, model);
    this.player.clear();
    this.turnStartedAt = Date.now();
    this.metrics = {
      ...this.metrics,
      direction,
      currentModel: model,
      firstInputTranscriptMs: undefined,
      firstTranslatedTranscriptMs: undefined,
      firstTranslatedAudioMs: undefined,
      droppedBuffers: 0,
    };
    this.emitMetrics();
    await this.adapter?.startInput();
  }

  sendAudio(buffer: ArrayBuffer): void {
    this.adapter?.sendAudio(buffer);
  }

  async endTurn(): Promise<void> {
    await this.adapter?.stopInput();
  }

  recordDroppedBuffer(): void {
    this.updateMetrics({ droppedBuffers: this.metrics.droppedBuffers + 1 });
  }

  onMetrics(callback: MetricsCallback): () => void {
    this.metricsCallbacks.add(callback);
    callback(this.metrics);
    return () => this.metricsCallbacks.delete(callback);
  }

  onTranscript(callback: TranscriptCallback): () => void {
    this.transcriptCallbacks.add(callback);
    return () => this.transcriptCallbacks.delete(callback);
  }

  onError(callback: (error: QwenLiveError) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  onTurnComplete(callback: () => void): () => void {
    this.turnCompleteCallbacks.add(callback);
    return () => this.turnCompleteCallbacks.delete(callback);
  }

  async dispose(): Promise<void> {
    await this.adapter?.disconnect();
    this.adapter = undefined;
    await this.player.dispose();
  }

  private bindAdapter(adapter: QwenLiveTranslateAdapter): void {
    adapter.onInputTranscript((text) => {
      if (this.adapter !== adapter) return;
      if (this.metrics.firstInputTranscriptMs === undefined) {
        this.updateMetrics({ firstInputTranscriptMs: this.elapsedTurnMs() });
      }
      this.transcriptCallbacks.forEach((callback) =>
        callback("input", text, this.direction),
      );
    });
    adapter.onOutputTranscript((text) => {
      if (this.adapter !== adapter) return;
      if (this.metrics.firstTranslatedTranscriptMs === undefined) {
        this.updateMetrics({
          firstTranslatedTranscriptMs: this.elapsedTurnMs(),
        });
      }
      this.transcriptCallbacks.forEach((callback) =>
        callback("output", text, this.direction),
      );
    });
    adapter.onAudio((pcm) => {
      if (this.adapter !== adapter) return;
      if (this.metrics.firstTranslatedAudioMs === undefined) {
        this.updateMetrics({ firstTranslatedAudioMs: this.elapsedTurnMs() });
      }
      this.player.enqueue(pcm);
    });
    adapter.onTurnComplete(() => {
      if (this.adapter !== adapter) return;
      this.turnCompleteCallbacks.forEach((callback) => callback());
    });
    adapter.onError((error) => {
      if (this.adapter !== adapter) return;
      this.errorCallbacks.forEach((callback) => callback(error));
    });
  }

  private updateMetrics(update: Partial<InterpreterMetrics>): void {
    this.metrics = { ...this.metrics, ...update };
    this.emitMetrics();
  }

  private emitMetrics(): void {
    this.metricsCallbacks.forEach((callback) => callback(this.metrics));
  }

  private elapsedTurnMs(): number {
    return this.turnStartedAt > 0 ? Date.now() - this.turnStartedAt : 0;
  }
}
