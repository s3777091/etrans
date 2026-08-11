const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/**
 * Wraps the raw 16-bit PCM captured for a hold-to-talk turn in a WAV container
 * so it can be posted to the speech-to-text endpoint as a data URL.
 */
export function encodeWavPcm16(
  chunks: ArrayBuffer[],
  sampleRate: number,
): ArrayBuffer {
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const bytes = new Uint8Array(buffer);
  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export function pcmDurationMs(byteLength: number, sampleRate: number): number {
  if (sampleRate <= 0) return 0;
  const samples = byteLength / ((CHANNELS * BITS_PER_SAMPLE) / 8);
  return Math.round((samples / sampleRate) * 1_000);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
