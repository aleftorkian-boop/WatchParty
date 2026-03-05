import { URL } from "node:url";

export const ROOM_ID_REGEX = /^[a-zA-Z0-9-]{3,32}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_REGEX.test(roomId);
}

export function sanitizeName(input: string | undefined): string {
  const trimmed = (input ?? "Guest").trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : "Guest";
}

export function sanitizeChatMessage(input: string): string {
  return input.trim().slice(0, 500);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw || raw.trim().length === 0) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function normalizePlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(0.25, Math.min(2, rate));
}

export function clampTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

