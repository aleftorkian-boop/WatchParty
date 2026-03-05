import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
const CLIENT_ID_KEY = "watch-party-client-id";

export function getClientId(): string {
  if (typeof window === "undefined") {
    return "server-render";
  }

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing?.trim()) {
    return existing;
  }

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

export function getSocket(): Socket {
  if (socket) return socket;
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";

  socket = io(serverUrl, {
    autoConnect: false,
    transports: ["websocket", "polling"],
  });

  return socket;
}
