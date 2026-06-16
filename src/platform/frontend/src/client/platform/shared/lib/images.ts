import { getDefaultAvatar, resolvePhotoUrl } from "./security.js";

interface ImageTarget {
  onerror: (() => void) | null;
  src: string;
}

function isImageTarget(value: unknown): value is ImageTarget {
  return Boolean(value && typeof value === "object" && "src" in value);
}

/** Apply a safe profile image URL and restore the default avatar on load failure. */
export function setImageWithFallback(
  imageElement: unknown,
  source: unknown,
  fallbackSource: unknown = getDefaultAvatar(),
): void {
  if (!isImageTarget(imageElement)) return;
  const fallback = resolvePhotoUrl(fallbackSource, getDefaultAvatar());
  imageElement.onerror = () => {
    imageElement.onerror = null;
    imageElement.src = fallback;
  };
  imageElement.src = resolvePhotoUrl(source, fallback);
}

export function applyImage(imageElement: unknown, source: unknown): void {
  setImageWithFallback(imageElement, source);
}
