/** Client-side image helpers (browser only). Thumbnails are generated locally — nothing is uploaded. */

export async function loadImageBitmap(source: Blob): Promise<ImageBitmap> {
  return createImageBitmap(source);
}

/** Draw a blob into a canvas at a maximum dimension and return a compressed JPEG thumbnail. */
export async function makeThumbnail(source: Blob, maxDim = 480, quality = 0.82): Promise<Blob | undefined> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(source);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", quality));
  } catch (error) {
    console.error("Thumbnail generation failed:", error);
    return undefined;
  } finally {
    bitmap?.close();
  }
}

export function revokeObjectUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
