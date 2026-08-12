import {
  AudioContext,
  type AudioBufferQueueSourceNode,
} from "react-native-audio-api";

import {
  activatePlaybackSession,
  releasePlaybackSession,
} from "./audio-session";

const OUTPUT_SAMPLE_RATE = 24_000;
const START_BUFFER_MS = 40;
const MAX_START_WAIT_MS = 70;

/** What playback did for one turn, reported so silence can be diagnosed. */
export interface PlaybackDiagnostics {
  chunks: number;
  bytes: number;
  queuedMs: number;
  started: boolean;
  stateAtFirstChunk?: string;
  stateAfterWake?: string;
  wake?: string;
  resume?: string;
  startError?: string;
}

function emptyDiagnostics(): PlaybackDiagnostics {
  return { chunks: 0, bytes: 0, queuedMs: 0, started: false };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PcmJitterPlayer {
  private readonly context = new AudioContext();
  private queue: AudioBufferQueueSourceNode | undefined;
  private started = false;
  private queuedMs = 0;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private wakePromise: Promise<void> | undefined;
  private report: PlaybackDiagnostics = emptyDiagnostics();
  private readonly durations = new Map<string, number>();

  constructor(private readonly onQueueChanged: (queueMs: number) => void) {
    this.createQueue();
  }

  enqueue(pcm: ArrayBuffer): void {
    const sampleCount = Math.floor(pcm.byteLength / 2);
    if (sampleCount <= 0) return;

    // expo-audio deactivates the audio session when the microphone stops, and
    // that native teardown can land *after* any attempt to undo it from the
    // same moment -- which is why restoring the session at stop time did not
    // hold. The translation arrives a network round trip later, so the session
    // is claimed back here, where playback actually begins and nothing else is
    // still tearing it down.
    if (!this.started) {
      if (!this.report.chunks) {
        this.report.stateAtFirstChunk = this.context.state;
      }
      void this.wakeOutput();
    }
    this.report.chunks += 1;
    this.report.bytes += pcm.byteLength;
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
    this.wakePromise = undefined;
    this.durations.clear();
    this.onQueueChanged(0);
    this.createQueue();
  }

  async dispose(): Promise<void> {
    this.clear();
    // Never leave the session held open behind a closing app.
    await releasePlaybackSession().catch(() => undefined);
    await this.context.close();
  }

  /** Reactivate the session and the context, once per burst of audio. */
  private wakeOutput(): Promise<void> {
    this.wakePromise ??= (async () => {
      try {
        await activatePlaybackSession();
        this.report.wake = "ok";
      } catch (error) {
        this.report.wake = describeError(error);
      }
      try {
        if (this.context.state === "suspended") await this.context.resume();
      } catch (error) {
        this.report.resume = describeError(error);
      }
      this.report.stateAfterWake = this.context.state;
    })();
    return this.wakePromise;
  }

  private start(): void {
    if (this.started || !this.queue || this.queuedMs <= 0) return;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    this.started = true;
    const queue = this.queue;
    // The session must be awake BEFORE the queue starts. Kicking the wake off
    // and starting in the same tick -- which is what the first chunk did, being
    // longer than the start threshold on its own -- starts playback into the
    // session expo-audio has just deactivated, and nothing is heard.
    void this.wakeOutput().then(() => {
      if (this.queue !== queue || !this.started) return;
      try {
        // The offset is passed explicitly because the library cannot be called
        // without it: start(when, offset = -1) then rejects its own default
        // with "offset must be a finite non-negative number: -1", so every
        // one-argument call throws and the queue never plays. Zero is the
        // start of the queue, which is where a fresh burst begins anyway.
        queue.start(this.context.currentTime, 0);
        this.report.started = true;
      } catch (error) {
        this.report.startError = describeError(error);
      }
    });
  }

  /** Hand over what playback actually did this turn, and start counting again. */
  takeDiagnostics(): PlaybackDiagnostics {
    const report = { ...this.report, queuedMs: Math.round(this.queuedMs) };
    this.report = emptyDiagnostics();
    return report;
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
        // The answer has finished speaking, so the phone gets its speaker
        // back. Holding an active playAndRecord session any longer takes the
        // route away from every other app on the phone.
        void releasePlaybackSession().catch(() => undefined);
      }
    };
    this.queue = queue;
  }
}

