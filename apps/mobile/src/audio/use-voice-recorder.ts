import { useCallback, useRef } from "react";
import { useAudioStream, type AudioStreamBuffer } from "expo-audio";

import { Pcm16InputProcessor } from "./pcm-input";
import { encodeWavPcm16, pcmDurationMs } from "./wav";

const RECORDING_SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 350;
const MAX_RECORDING_BYTES = (RECORDING_SAMPLE_RATE * 2 * MAX_RECORDING_MS) / 1_000;

export interface VoiceRecording {
  wav: ArrayBuffer;
  durationMs: number;
}

/**
 * Hold-to-talk capture for the agent. The interpreter processor is reused so
 * hardware sample rates are resampled to the 16 kHz mono PCM the ASR expects.
 */
export function useVoiceRecorder() {
  const activeRef = useRef(false);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const bytesRef = useRef(0);
  const processorRef = useRef(new Pcm16InputProcessor());

  const onBuffer = useCallback((audio: AudioStreamBuffer) => {
    if (!activeRef.current || bytesRef.current >= MAX_RECORDING_BYTES) return;
    for (const chunk of processorRef.current.push(audio.data, audio.sampleRate)) {
      chunksRef.current.push(chunk);
      bytesRef.current += chunk.byteLength;
    }
  }, []);

  const { stream } = useAudioStream({
    sampleRate: RECORDING_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer,
  });

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    chunksRef.current = [];
    bytesRef.current = 0;
    processorRef.current.reset();
    try {
      await stream.start();
    } catch (error) {
      activeRef.current = false;
      throw error;
    }
  }, [stream]);

  const stop = useCallback(async (): Promise<VoiceRecording | undefined> => {
    if (!activeRef.current) return undefined;
    activeRef.current = false;
    stream.stop();

    const tail = processorRef.current.flush();
    if (tail) chunksRef.current.push(tail);
    const chunks = chunksRef.current;
    chunksRef.current = [];
    bytesRef.current = 0;

    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const durationMs = pcmDurationMs(byteLength, RECORDING_SAMPLE_RATE);
    if (durationMs < MIN_RECORDING_MS) return undefined;
    return {
      wav: encodeWavPcm16(chunks, RECORDING_SAMPLE_RATE),
      durationMs,
    };
  }, [stream]);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    stream.stop();
    processorRef.current.reset();
    chunksRef.current = [];
    bytesRef.current = 0;
  }, [stream]);

  return { start, stop, cancel };
}
