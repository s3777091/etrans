import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const MAX_IMAGE_WIDTH = 1_280;

/** Compresses a captured photo into the JPEG data URL the agent accepts. */
export async function compressPhotoForAgent(
  uri: string,
  width: number,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (width > MAX_IMAGE_WIDTH) {
    context.resize({ width: MAX_IMAGE_WIDTH });
  }
  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({
    base64: true,
    compress: 0.7,
    format: SaveFormat.JPEG,
  });
  if (!compressed.base64) {
    throw new Error("Không thể đọc ảnh từ camera");
  }
  return `data:image/jpeg;base64,${compressed.base64}`;
}
