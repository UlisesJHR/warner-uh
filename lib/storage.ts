import { put } from "@vercel/blob";

/**
 * Reward image storage.
 *
 * Photos must never live inside the database, so the file is uploaded to Vercel
 * Blob and only the public URL is stored on the reward row. When no Blob token is
 * configured the caller gets a clear error instead of a silent failure.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type UploadResult = { url: string } | { error: string };

/** Validate and upload one image, returning its public URL. */
export async function uploadRewardImage(file: File | null): Promise<UploadResult | null> {
  if (!file || file.size === 0) {
    return null;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Upload a PNG, JPEG, WebP or GIF image." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Images must be 4 MB or smaller." };
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return { error: "Image storage is not configured. Set BLOB_READ_WRITE_TOKEN or paste an image URL." };
  }
  try {
    const blob = await put(`rewards/${Date.now()}-${file.name}`, file, {
      access: "public",
      token,
      addRandomSuffix: true,
    });
    return { url: blob.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The upload failed." };
  }
}
