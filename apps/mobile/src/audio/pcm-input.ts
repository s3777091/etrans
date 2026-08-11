const TARGET_SAMPLE_RATE = 16_000;
// Qwen's official realtime sample sends 1,600 samples at 16 kHz (100 ms).
const TARGET_CHUNK_MS = 100;
const TARGET_SAMPLES = (TARGET_SAMPLE_RATE * TARGET_CHUNK_MS) / 1_000;

export class Pcm16InputProcessor {
  private pending = new Int16Array(0);

  push(buffer: ArrayBuffer, sampleRate: number): ArrayBuffer[] {
    const source = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2));
    const samples =
      sampleRate === TARGET_SAMPLE_RATE
        ? source
        : resampleLinearPcm16(source, sampleRate, TARGET_SAMPLE_RATE);

    if (samples.length === 0) return [];
    if (this.pending.length === 0 && samples.length === TARGET_SAMPLES) {
      return [copyArrayBuffer(samples)];
    }

    const combined = new Int16Array(this.pending.length + samples.length);
    combined.set(this.pending, 0);
    combined.set(samples, this.pending.length);

    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    while (combined.length - offset >= TARGET_SAMPLES) {
      chunks.push(
        copyArrayBuffer(combined.subarray(offset, offset + TARGET_SAMPLES)),
      );
      offset += TARGET_SAMPLES;
    }

    this.pending = combined.slice(offset);
    return chunks;
  }

  flush(): ArrayBuffer | undefined {
    if (this.pending.length === 0) return undefined;
    const tail = copyArrayBuffer(this.pending);
    this.pending = new Int16Array(0);
    return tail;
  }

  reset(): void {
    this.pending = new Int16Array(0);
  }
}

function resampleLinearPcm16(
  input: Int16Array,
  inputRate: number,
  outputRate: number,
): Int16Array {
  if (inputRate <= 0 || outputRate <= 0 || input.length === 0) {
    return new Int16Array(0);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    const leftSample = input[left] ?? 0;
    const rightSample = input[right] ?? leftSample;
    output[index] = Math.round(
      leftSample + (rightSample - leftSample) * fraction,
    );
  }

  return output;
}

function copyArrayBuffer(samples: Int16Array): ArrayBuffer {
  const copy = new Int16Array(samples.length);
  copy.set(samples);
  return copy.buffer;
}
