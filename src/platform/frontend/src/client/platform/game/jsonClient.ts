import { gameRequestHeaders } from "../features/gameplay/gameRequestHeaders.js";
import type { ApiError, JsonObject } from "../shared/contracts.js";

const HEADERS_JSON = { "Content-Type": "application/json", Accept: "application/json" };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function gameJsonRequest<T = JsonObject>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(HEADERS_JSON);
  for (const [key, value] of Object.entries(gameRequestHeaders())) {
    headers.set(key, value);
  }
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  const opts: RequestInit = {
    credentials: "include",
    ...init,
    headers,
  };
  let response: Response;
  try {
    response = await fetch(url, opts);
  } catch (error) {
    const networkErr = new Error(errorMessage(error, "Network error")) as ApiError;
    networkErr.status = 0;
    throw networkErr;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;
    const message = String(isJsonObject(body) ? body.error || fallback : fallback).trim();
    const error = new Error(message || "Request failed.") as ApiError;
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body as T;
}
