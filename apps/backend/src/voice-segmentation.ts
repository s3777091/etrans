const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;

export interface SpeechSegmenterOptions {
  /** Natural pause that closes the current utterance. */
  silenceMs: number;
  /** Reject clicks, taps, and other very short noises. */
  minimumVoicedMs: number;
  /**
   * Voiced audio a segment must hold before a pause is allowed to close it.
   * The ASR identifies the spoken language from the segment alone, and on
   * anything shorter it guesses: measured against this endpoint, sub-second
   * slices of Vietnamese speech come back as Chinese ("跟。", "可能。") while
   * the same sentence sent whole transcribes correctly. Mid-sentence breaths
   * must therefore extend the segment, never cut it.
   */
  minimumUtteranceMs: number;
  /**
   * A pause this long ends the utterance whatever its length. Waiting for
   * `minimumUtteranceMs` keeps a breath from splitting a sentence, but it also
   * makes a short finished one sit until the speaker lets go. Nobody breathes
   * this long mid-sentence, so a gap this size is an ending, not a pause.
   */
  longSilenceMs: number;
  /** Keep a little audio before speech so initial consonants are not clipped. */
  preRollMs: number;
  /** Safety boundary for speakers who never pause. */
  maximumSegmentMs: number;
  minimumRms: number;
  minimumPeak: number;
}

export const DEFAULT_SPEECH_SEGMENTER_OPTIONS: SpeechSegmenterOptions = {
  silenceMs: 700,
  minimumVoicedMs: 250,
  minimumUtteranceMs: 1_500,
  longSilenceMs: 1_200,
  preRollMs: 200,
  maximumSegmentMs: 12_000,
  minimumRms: 420,
  minimumPeak: 1_100,
};

interface TimedChunk {
  pcm: Buffer;
  durationMs: number;
}

/**
 * Small server-side VAD for the app's 16 kHz mono PCM stream. It does not try
 * to identify a language: it only finds speech-shaped audio and natural pauses.
 * The locked ASR performs the language check before anything reaches MT/TTS.
 */
export class StreamingSpeechSegmenter {
  private readonly options: SpeechSegmenterOptions;
  private preRoll: TimedChunk[] = [];
  private preRollDurationMs = 0;
  private active: TimedChunk[] = [];
  private activeDurationMs = 0;
  private voicedDurationMs = 0;
  private trailingSilenceMs = 0;
  private noiseFloor = 140;

  constructor(options: Partial<SpeechSegmenterOptions> = {}) {
    this.options = { ...DEFAULT_SPEECH_SEGMENTER_OPTIONS, ...options };
  }

  push(pcm: Buffer): Buffer[] {
    if (pcm.length < BYTES_PER_SAMPLE) return [];
    const durationMs = pcmDurationMs(pcm);
    const { rms, peak } = analyzePcm16(pcm);
    const speechThreshold = Math.max(
      this.options.minimumRms,
      this.noiseFloor * 2.7,
    );
    const voiced = rms >= speechThreshold && peak >= this.options.minimumPeak;
    const chunk = { pcm, durationMs };

    if (!this.active.length) {
      if (!voiced) {
        this.updateNoiseFloor(rms);
        this.addPreRoll(chunk);
        return [];
      }
      this.active = [...this.preRoll, chunk];
      this.activeDurationMs = this.preRollDurationMs + durationMs;
      this.voicedDurationMs = durationMs;
      this.trailingSilenceMs = 0;
      this.preRoll = [];
      this.preRollDurationMs = 0;
      return [];
    }

    this.active.push(chunk);
    this.activeDurationMs += durationMs;
    if (voiced) {
      this.voicedDurationMs += durationMs;
      this.trailingSilenceMs = 0;
    } else {
      this.trailingSilenceMs += durationMs;
    }

    // A pause only ends the utterance once there is enough speech in it for
    // the ASR to place the language; otherwise the pause is swallowed and the
    // segment keeps growing into the next words. A pause long enough to be an
    // ending rather than a breath closes it either way, so a short sentence is
    // not held back until the speaker lets go.
    const naturalBoundary =
      (this.trailingSilenceMs >= this.options.silenceMs &&
        this.voicedDurationMs >= this.options.minimumUtteranceMs) ||
      (this.trailingSilenceMs >= this.options.longSilenceMs &&
        this.voicedDurationMs >= this.options.minimumVoicedMs);
    const safetyBoundary =
      this.activeDurationMs >= this.options.maximumSegmentMs &&
      this.voicedDurationMs >= this.options.minimumVoicedMs;
    if (!naturalBoundary && !safetyBoundary) return [];

    const segment = this.takeActiveSegment();
    // Silence at the end of one utterance is also useful pre-roll for the next.
    if (naturalBoundary) this.addPreRoll(chunk);
    return segment ? [segment] : [];
  }

  flush(): Buffer | undefined {
    if (
      !this.active.length ||
      this.voicedDurationMs < this.options.minimumVoicedMs
    ) {
      this.reset();
      return undefined;
    }
    return this.takeActiveSegment();
  }

  private addPreRoll(chunk: TimedChunk): void {
    this.preRoll.push(chunk);
    this.preRollDurationMs += chunk.durationMs;
    while (
      this.preRoll.length > 1 &&
      this.preRollDurationMs > this.options.preRollMs
    ) {
      const removed = this.preRoll.shift();
      this.preRollDurationMs -= removed?.durationMs ?? 0;
    }
  }

  private updateNoiseFloor(rms: number): void {
    // Slow adaptation handles different phone microphones without allowing a
    // sudden bang to teach the detector that loud noise is normal silence.
    const bounded = Math.min(rms, this.noiseFloor * 1.5 + 80);
    this.noiseFloor = Math.max(60, this.noiseFloor * 0.92 + bounded * 0.08);
  }

  private takeActiveSegment(): Buffer | undefined {
    const segment = this.active.length
      ? Buffer.concat(this.active.map((chunk) => chunk.pcm))
      : undefined;
    this.active = [];
    this.activeDurationMs = 0;
    this.voicedDurationMs = 0;
    this.trailingSilenceMs = 0;
    return segment;
  }

  private reset(): void {
    this.preRoll = [];
    this.preRollDurationMs = 0;
    this.active = [];
    this.activeDurationMs = 0;
    this.voicedDurationMs = 0;
    this.trailingSilenceMs = 0;
  }
}

export function analyzePcm16(pcm: Buffer): { rms: number; peak: number } {
  const sampleCount = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  if (!sampleCount) return { rms: 0, peak: 0 };
  let squareSum = 0;
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    squareSum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(squareSum / sampleCount), peak };
}

function pcmDurationMs(pcm: Buffer): number {
  return (pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1_000;
}
