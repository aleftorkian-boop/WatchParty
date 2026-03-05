import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
const CLIENT_ID_KEY = "watch-party-client-id";

export function getClientId(): string {
  if (typeof window === "undefined") return "server-render";

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing?.trim()) return existing;

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

function resolveSocketUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    process.env.NEXT_PUBLIC_STREAM_BASE_URL ||
    process.env.NEXT_PUBLIC_SERVER_URL;

  const isBrowser = typeof window !== "undefined";
  const isLocal = isBrowser && window.location.hostname === "localhost";

  // In production (not localhost), we REQUIRE an env URL.
  if (!envUrl && !isLocal) {
    throw new Error(
      "Missing NEXT_PUBLIC_SOCKET_URL. Set it in Netlify environment variables."
    );
  }

  // Local dev fallback only.
  return envUrl || "http://localhost:4000";
}

export function getSocket(): Socket {
  if (socket) return socket;

  const socketUrl = resolveSocketUrl();

  socket = io(socketUrl, {
    autoConnect: false,
    transports: ["websocket", "polling"],
  });

  return socket;
}