export {
  isAllowedPhotoUrl,
  resolvePhotoUrl,
  getDefaultAvatar,
} from "../../../platform/shared/lib/security.js";

export function pieceCodeLooksValid(code: unknown): boolean {
  return /^[wb][PNBRQKZFC]$/i.test(String(code || "").trim());
}
