import type { ParsedVideoUrl } from "./types";

function hasDirectVideoExtension(pathname: string): boolean {
  return /\.(mp4|webm|m3u8)$/i.test(pathname);
}

export function parseVideoUrl(raw: string): ParsedVideoUrl {
  const input = raw.trim();
  if (!input) {
    throw new Error("Video URL is required");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  const isDirectFile = hasDirectVideoExtension(url.pathname);
  const isHls = /\.m3u8$/i.test(url.pathname);

  return {
    normalizedUrl: url.toString(),
    isHls,
    isDirectFile,
    shouldPreferProxy: !isDirectFile,
  };
}

export function detectHlsFromSource(source: string | null): boolean {
  if (!source) return false;

  try {
    const parsed = new URL(source);
    if (/\.m3u8$/i.test(parsed.pathname)) return true;

    if (/\/stream$/i.test(parsed.pathname)) {
      const proxied = parsed.searchParams.get("url");
      if (proxied) {
        const upstream = new URL(proxied);
        return /\.m3u8$/i.test(upstream.pathname);
      }
    }
  } catch {
    return /\.m3u8($|\?)/i.test(source);
  }

  return false;
}

