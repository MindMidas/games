const DEFAULT_AVATAR_PATHS = Object.freeze({
  hub: "/static/shared/avatars/default-user-outline.svg",
  pool: "/static/shared/avatars/default-user-pool.svg",
  chezz: "/static/shared/avatars/default-user-chezz.svg",
});

type AvatarGameId = keyof typeof DEFAULT_AVATAR_PATHS;

export function getDefaultAvatar(gameId?: unknown): string {
  const id = String(gameId ?? document.documentElement?.dataset?.game ?? "hub");
  return DEFAULT_AVATAR_PATHS[id as AvatarGameId] ?? DEFAULT_AVATAR_PATHS.hub;
}

export function isAllowedPhotoUrl(url: unknown): boolean {
  const text = String(url || "").trim();
  if (!text || text.length > 500 || text === "null" || text === "undefined") {
    return false;
  }
  return (
    text.startsWith("https://")
    || text.startsWith("/static/")
  );
}

export function resolvePhotoUrl(url: unknown, fallback?: string): string {
  const fb = fallback ?? getDefaultAvatar();
  return isAllowedPhotoUrl(url) ? String(url).trim() : fb;
}
