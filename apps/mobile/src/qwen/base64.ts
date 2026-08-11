import { fromByteArray, toByteArray } from "base64-js";

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return fromByteArray(new Uint8Array(buffer));
}

export function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = toByteArray(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
