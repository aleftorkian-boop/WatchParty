import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { InMemoryRateLimiter } from "./rateLimit";
import { isValidHttpUrl, parseAllowlist } from "./utils";

interface ProxyConfig {
  enableProxy: boolean;
  allowedOrigin: string;
  allowlist: Set<string>;
  maxBytes: number;
}

const limiter = new InMemoryRateLimiter(60_000, 120);

function setCorsHeaders(res: Response, allowedOrigin: string): void {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length, Content-Type"
  );
}

export function streamPreflightHandler(config: ProxyConfig) {
  return (_req: Request, res: Response): void => {
    setCorsHeaders(res, config.allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(204).end();
  };
}

export function streamHandler(config: ProxyConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    setCorsHeaders(res, config.allowedOrigin);

    if (!config.enableProxy) {
      res.status(404).json({ error: "Proxy is disabled" });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!limiter.allow(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!isValidHttpUrl(rawUrl)) {
      res.status(400).json({ error: "Invalid url parameter" });
      return;
    }

    let upstream: URL;
    try {
      upstream = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Malformed url parameter" });
      return;
    }

    if (config.allowlist.size > 0 && !config.allowlist.has(upstream.hostname.toLowerCase())) {
      res.status(403).json({ error: "Domain is not allowed" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const forwardedHeaders: HeadersInit = {};
      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === "string") {
        forwardedHeaders["Range"] = rangeHeader;
      }

      const upstreamRes = await fetch(upstream, {
        method: "GET",
        headers: forwardedHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const contentLength = upstreamRes.headers.get("content-length");
      if (contentLength && Number(contentLength) > config.maxBytes) {
        res.status(413).json({ error: "Upstream content too large" });
        return;
      }

      const status = upstreamRes.status;
      res.status(status);

      const contentType = upstreamRes.headers.get("content-type");
      const acceptRanges = upstreamRes.headers.get("accept-ranges");
      const contentRange = upstreamRes.headers.get("content-range");
      const contentLen = upstreamRes.headers.get("content-length");

      if (contentType) res.setHeader("Content-Type", contentType);
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (contentLen) res.setHeader("Content-Length", contentLen);

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstreamRes.body as unknown as ReadableStream<Uint8Array>).pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: "Failed to fetch upstream video" });
      } else {
        res.end();
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function buildProxyConfig(env: NodeJS.ProcessEnv): ProxyConfig {
  const nodeEnv = env.NODE_ENV || "development";
  return {
    enableProxy: env.ENABLE_PROXY !== "false",
    allowedOrigin:
      env.PROXY_ALLOWED_ORIGIN || env.CORS_ORIGIN || (nodeEnv === "production" ? "https://example.com" : "*"),
    allowlist: parseAllowlist(env.PROXY_ALLOWLIST),
    maxBytes: Number(env.PROXY_MAX_BYTES || 524_288_000),
  };
}

