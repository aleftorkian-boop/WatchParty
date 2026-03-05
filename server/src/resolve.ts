import type { Express, Request, Response } from "express";
import { isValidHttpUrl } from "./utils";

type ResolveKind = "youtube" | "mp4" | "webm" | "hls" | "unknown";

interface ResolveOkResponse {
  ok: true;
  inputUrl: string;
  resolvedUrl: string;
  kind: ResolveKind;
  videoId?: string;
  needsProxy: boolean;
  reason: string;
}

interface ResolveErrorResponse {
  ok: false;
  error: string;
}

function kindFromPathname(pathname: string): ResolveKind {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".mp4")) return "mp4";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".m3u8")) return "hls";
  return "unknown";
}

function isValidYouTubeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const candidate = pathParts[0] || "";
    return isValidYouTubeId(candidate) ? candidate : null;
  }

  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      const candidate = url.searchParams.get("v") || "";
      return isValidYouTubeId(candidate) ? candidate : null;
    }

    if (pathParts[0] === "embed" || pathParts[0] === "shorts") {
      const candidate = pathParts[1] || "";
      return isValidYouTubeId(candidate) ? candidate : null;
    }
  }

  return null;
}

function extractDriveId(url: URL): string | null {
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
  if (fileMatch?.[1]) return fileMatch[1];

  const idParam = url.searchParams.get("id");
  if (idParam) return idParam;

  return null;
}

function resolveBestEffort(inputUrl: string): ResolveOkResponse {
  const parsed = new URL(inputUrl);
  const host = parsed.hostname.toLowerCase();
  const youTubeId = extractYouTubeId(parsed);

  if (youTubeId) {
    return {
      ok: true,
      inputUrl,
      resolvedUrl: inputUrl,
      kind: "youtube",
      videoId: youTubeId,
      needsProxy: false,
      reason: "YouTube link detected",
    };
  }

  const directKind = kindFromPathname(parsed.pathname);
  if (directKind !== "unknown") {
    return {
      ok: true,
      inputUrl,
      resolvedUrl: inputUrl,
      kind: directKind,
      needsProxy: false,
      reason: "Direct media link",
    };
  }

  if (host === "drive.google.com") {
    const id = extractDriveId(parsed);
    if (id) {
      return {
        ok: true,
        inputUrl,
        resolvedUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
        kind: "unknown",
        needsProxy: true,
        reason: "Google Drive share converted to download URL",
      };
    }
  }

  if (host === "www.dropbox.com" || host === "dropbox.com") {
    const out = new URL(inputUrl);
    out.searchParams.set("dl", "1");
    return {
      ok: true,
      inputUrl,
      resolvedUrl: out.toString(),
      kind: kindFromPathname(out.pathname),
      needsProxy: false,
      reason: "Dropbox share converted to direct download parameter",
    };
  }

  if (host.includes("onedrive.live.com") || host.includes("1drv.ms")) {
    return {
      ok: true,
      inputUrl,
      resolvedUrl: inputUrl,
      kind: "unknown",
      needsProxy: true,
      reason: "OneDrive share links may require proxy; direct stream varies",
    };
  }

  return {
    ok: true,
    inputUrl,
    resolvedUrl: inputUrl,
    kind: "unknown",
    needsProxy: true,
    reason: "Unknown link type; proxy may help with CORS/range",
  };
}

export function registerResolveRoute(app: Express): void {
  app.post("/resolve", (req: Request, res: Response<ResolveOkResponse | ResolveErrorResponse>) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      res.status(400).json({ ok: false, error: "url is required" });
      return;
    }

    if (!isValidHttpUrl(url)) {
      res.status(400).json({ ok: false, error: "Only http/https URLs are allowed" });
      return;
    }

    try {
      res.json(resolveBestEffort(url));
    } catch {
      res.status(500).json({ ok: false, error: "Failed to resolve URL" });
    }
  });
}
