import {
  AudioContext,
  type AudioBufferQueueSourceNode,
} from "react-native-audio-api";

const OUTPUT_SAMPLE_RATE = 24_000;
const START_BUFFER_MS = 40;
const MAX_START_WAIT_MS = 70;

export class PcmJitterPlayer {
  private readonly context = new AudioContext();
  private queue: AudioBufferQueueSourceNode | undefined;
  private started = false;
  private queuedMs = 0;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly durations = new Map<string, number>();

  constructor(private readonly onQueueChanged: (queueMs: number) => void) {
    this.createQueue();
  }

  enqueue(pcm: ArrayBuffer): void {
    const sampleCount = Math.floor(pcm.byteLength / 2);
    if (sampleCount <= 0) return;

    // Recording stops between turns and the session is set not to mix, so the
    // context can be left suspended by an interruption. A suspended context
    // accepts buffers and plays none of them.
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    if (!this.queue) this.createQueue();
    const audioBuffer = this.context.createBuffer(
      1,
      sampleCount,
      OUTPUT_SAMPLE_RATE,
    );
    const destination = audioBuffer.getChannelData(0);
    const source = new Int16Array(pcm, 0, sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      destination[index] = (source[index] ?? 0) / 32_768;
    }

    const durationMs = (sampleCount / OUTPUT_SAMPLE_RATE) * 1_000;
    const bufferId = this.queue!.enqueueBuffer(audioBuffer);
    this.durations.set(bufferId, durationMs);
    this.queuedMs += durationMs;
    this.onQueueChanged(Math.round(this.queuedMs));

    if (!this.started && this.queuedMs >= START_BUFFER_MS) {
      this.start();
    } else if (!this.started && !this.startTimer) {
      this.startTimer = setTimeout(() => this.start(), MAX_START_WAIT_MS);
    }
  }

  clear(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    try {
      this.queue?.stop();
      this.queue?.disconnect();
    } catch {
      // The queue may already have reached its natural end.
    }
    this.queue = undefined;
    this.started = false;
    this.queuedMs = 0;
    this.durations.clear();
    this.onQueueChanged(0);
    this.createQueue();
  }

  async dispose(): Promise<void> {
    this.clear();
    await this.context.close();
  }

  private start(): void {
    if (this.started || !this.queue || this.queuedMs <= 0) return;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    this.started = true;
    this.queue.start(this.context.currentTime);
  }

  private createQueue(): void {
    const queue = this.context.createBufferQueueSource({
      pitchCorrection: false,
    });
    queue.connect(this.context.destination);
    queue.onBufferEnded = (event) => {
      const durationMs = this.durations.get(event.bufferId) ?? 0;
      this.durations.delete(event.bufferId);
      this.queuedMs = Math.max(0, this.queuedMs - durationMs);
      this.onQueueChanged(Math.round(this.queuedMs));
      if (event.isLastBufferInQueue) {
        this.started = false;
        this.queue = undefined;
        this.createQueue();
      }
    };
    this.queue = queue;
  }
}

