const MAX_EDGE = 2400;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/**
 * Shrink a large photo before upload: phone photos are often 4-12 MB, and a 2400px
 * JPEG keeps handwriting legible while uploading far faster. Falls back to the
 * original file if the browser cannot decode it (e.g. HEIC outside Safari).
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.size <= SHRINK_ABOVE_BYTES) return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
    return { blob, name: file.name.replace(/\.\w+$/, "") + ".jpg" };
  } catch {
    return { blob: file, name: file.name };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
