import { useCallback, useRef } from "react";
import { useAudioStream, type AudioStreamBuffer } from "expo-audio";

import type {
  InterpreterDirection,
  VoiceTranslationModel,
} from "../qwen/types";
import type { LiveInterpreterEngine } from "../interpreter/engine";
import { configurePlaybackRouting } from "./audio-session";
import { Pcm16InputProcessor } from "./pcm-input";

const MAX_STARTUP_CHUNKS = 8;

interface AudioControllerOptions {
  engine: LiveInterpreterEngine;
  onError: (error: unknown) => void;
}

export function useInterpreterAudio({
  engine,
  onError,
}: AudioControllerOptions) {
  const activeRef = useRef(false);
  const readyRef = useRef(false);
  const processorRef = useRef(new Pcm16InputProcessor());
  const startupQueueRef = useRef<ArrayBuffer[]>([]);
  const startPromiseRef = useRef<Promise<boolean> | undefined>(undefined);

  const sendOrQueue = useCallback(
    (chunk: ArrayBuffer) => {
      if (readyRef.current) {
        engine.sendAudio(chunk);
        return;
      }

      const queue = startupQueueRef.current;
      if (queue.length >= MAX_STARTUP_CHUNKS) {
        queue.shift();
        engine.recordDroppedBuffer();
      }
      queue.push(chunk);
    },
    [engine],
  );

  const onBuffer = useCallback(
    (audio: AudioStreamBuffer) => {
      if (!activeRef.current) return;
      const chunks = processorRef.current.push(audio.data, audio.sampleRate);
      chunks.forEach(sendOrQueue);
    },
    [sendOrQueue],
  );

  const { stream, isStreaming } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: "int16",
    onBuffer,
  });

  const activate = useCallback(
    async (
      direction: InterpreterDirection,
      model: VoiceTranslationModel,
    ) => {
      if (activeRef.current) return;
      activeRef.current = true;
      readyRef.current = false;
      processorRef.current.reset();
      startupQueueRef.current = [];

      const startPromise = (async () => {
        await stream.start();
        if (!activeRef.current) {
          stream.stop();
          return false;
        }
        // Starting the microphone reconfigures the session, so the speaker
        // route has to be claimed back after it, not before.
        await configurePlaybackRouting();

        await engine.beginTurn(direction, model);
        readyRef.current = true;
        const queued = startupQueueRef.current;
        startupQueueRef.current = [];
        queued.forEach((chunk) => engine.sendAudio(chunk));
        return true;
      })().catch((error) => {
        activeRef.current = false;
        readyRef.current = false;
        stream.stop();
        onError(error);
        throw error;
      });

      startPromiseRef.current = startPromise;
      await startPromise.catch(() => false);
    },
    [engine, onError, stream],
  );

  const deactivate = useCallback(async (): Promise<boolean> => {
    const startPromise = startPromiseRef.current;
    if (!activeRef.current && !startPromise) return false;

    activeRef.current = false;
    stream.stop();
    const tail = processorRef.current.flush();
    if (tail) sendOrQueue(tail);

    let turnStarted = false;
    try {
      turnStarted = (await startPromise) ?? false;
      if (turnStarted) {
        await engine.endTurn();
      }
    } catch {
      // Activation reports its own error. Release only completes cleanup.
    } finally {
      readyRef.current = false;
      startupQueueRef.current = [];
      startPromiseRef.current = undefined;
    }
    return turnStarted;
  }, [engine, onError, sendOrQueue, stream]);

  return { activate, deactivate, isStreaming };
}
