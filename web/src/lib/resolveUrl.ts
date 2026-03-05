import type { ResolvedKind } from "./types";

type ResolveUrlResult = {
  ok: boolean;
  resolvedUrl?: string;
  needsProxy?: boolean;
  kind?: ResolvedKind;
  videoId?: string;
  reason?: string;
  error?: string;
};

function getResolveBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_STREAM_BASE_URL ||
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    process.env.NEXT_PUBLIC_SERVER_URL ||
    "http://localhost:4000"
  );
}

export async function resolveUrl(inputUrl: string): Promise<ResolveUrlResult> {
  try {
    const baseUrl = getResolveBaseUrl();
    const res = await fetch(`${baseUrl}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: inputUrl }),
    });

    const data = (await res.json()) as ResolveUrlResult;
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || "Failed to resolve URL",
      };
    }

    return data;
  } catch {
    return {
      ok: false,
      error: "Unable to reach resolver endpoint",
    };
  }
}
