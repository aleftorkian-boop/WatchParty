import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  addChatMessage,
  canControl,
  getClientIdBySocketId,
  getComputedPlaybackTime,
  getRoom,
  getRoomBySocketId,
  getPublicParticipants,
  isHostSocket,
  joinRoom,
  removeSocket,
} from "./rooms";
import { clampTime, isValidHttpUrl, isValidRoomId, normalizePlaybackRate, sanitizeChatMessage, sanitizeName } from "./utils";

const SYNC_BROADCAST_INTERVAL_MS = 5_000;
const DRIFT_THRESHOLD_SECONDS = 0.7;
const HOST_REASSIGN_GRACE_MS = 15_000;
const RECONNECT_PING_GUARD_MS = 3_000;
const RECONNECT_SEEK_GUARD_MS = 2_000;
const NEAR_ZERO_SECONDS = 0.25;
const NON_ZERO_ROOM_TIME_SECONDS = 1;

function emitParticipants(io: Server, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit("room:participants", {
    roomId,
    hostSocketId: room.state.hostSocketId,
    participants: getPublicParticipants(room),
  });
}

function emitRoomState(io: Server, roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit("room:state", room.state);
}

function hasControlPermission(roomId: string, socketId: string): boolean {
  const room = getRoom(roomId);
  if (!room) return false;
  return canControl(room, socketId);
}

export function buildSocketServer(httpServer: HttpServer, corsOrigin: string): Server {
  const hostGraceTimers = new Map<string, NodeJS.Timeout>();
  const socketJoinAtMs = new Map<string, number>();

  const shouldIgnoreNearZeroAfterJoin = (roomId: string, socketId: string, incomingTime: number, windowMs: number): boolean => {
    const joinedAt = socketJoinAtMs.get(socketId);
    if (!joinedAt) return false;
    if (Date.now() - joinedAt > windowMs) return false;

    const room = getRoom(roomId);
    if (!room || !room.state.videoUrl) return false;
    if (incomingTime > NEAR_ZERO_SECONDS) return false;

    const currentRoomTime = getComputedPlaybackTime(room);
    return currentRoomTime > NON_ZERO_ROOM_TIME_SECONDS;
  };
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("room:join", (payload: { roomId?: string; clientId?: string; name?: string }) => {
      const roomId = (payload?.roomId || "").trim();
      if (!isValidRoomId(roomId)) {
        socket.emit("error:message", "Invalid room ID");
        return;
      }

      const clientId = (payload?.clientId || "").trim();
      if (!clientId) {
        socket.emit("error:message", "Invalid client identity");
        return;
      }

      const name = sanitizeName(payload?.name);
      socket.join(roomId);
      const room = joinRoom(roomId, socket.id, clientId, name);
      socketJoinAtMs.set(socket.id, Date.now());

      if (room.hostClientId === clientId) {
        const timer = hostGraceTimers.get(roomId);
        if (timer) {
          clearTimeout(timer);
          hostGraceTimers.delete(roomId);
        }
      }

      socket.emit("room:state", room.state);
      socket.emit("room:chat:history", room.chat);
      emitParticipants(io, roomId);
      emitRoomState(io, roomId);
    });

    socket.on("video:set", (payload: { roomId?: string; url?: string }) => {
      const roomId = payload?.roomId || "";
      const url = payload?.url || "";
      const room = getRoom(roomId);
      if (!room || !hasControlPermission(roomId, socket.id)) return;
      if (!isValidHttpUrl(url)) {
        socket.emit("error:message", "Video URL must be http/https");
        return;
      }

      room.state.videoUrl = url;
      room.state.isPlaying = false;
      room.state.playbackTime = 0;
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("player:play", (payload: { roomId?: string; atTime?: number }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room || !hasControlPermission(roomId, socket.id)) return;

      room.state.playbackTime = clampTime(payload?.atTime ?? getComputedPlaybackTime(room));
      room.state.isPlaying = true;
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("player:pause", (payload: { roomId?: string; atTime?: number }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room || !hasControlPermission(roomId, socket.id)) return;

      room.state.playbackTime = clampTime(payload?.atTime ?? getComputedPlaybackTime(room));
      room.state.isPlaying = false;
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("player:seek", (payload: { roomId?: string; toTime?: number }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room || !hasControlPermission(roomId, socket.id)) return;
      const toTime = clampTime(payload?.toTime ?? 0);

      if (shouldIgnoreNearZeroAfterJoin(roomId, socket.id, toTime, RECONNECT_SEEK_GUARD_MS)) {
        return;
      }

      room.state.playbackTime = toTime;
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("player:rate", (payload: { roomId?: string; rate?: number }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room || !hasControlPermission(roomId, socket.id)) return;

      room.state.playbackRate = normalizePlaybackRate(payload?.rate ?? 1);
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("controls:toggle", (payload: { roomId?: string; allowAllControls?: boolean }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room || !isHostSocket(room, socket.id)) return;

      room.state.allowAllControls = Boolean(payload?.allowAllControls);
      room.state.lastUpdateMs = Date.now();
      emitRoomState(io, roomId);
    });

    socket.on("host:transfer", (payload: { roomId?: string; toSocketId?: string }) => {
      const roomId = payload?.roomId || "";
      const toSocketId = payload?.toSocketId || "";
      const room = getRoom(roomId);
      if (!room || !isHostSocket(room, socket.id)) return;
      const target = room.participants.find((participant) => participant.socketId === toSocketId);
      if (!target) return;

      room.hostClientId = target.clientId;
      room.state.hostSocketId = target.socketId;
      room.state.lastUpdateMs = Date.now();
      emitParticipants(io, roomId);
      emitRoomState(io, roomId);
    });

    socket.on("chat:message", (payload: { roomId?: string; name?: string; message?: string; ts?: number }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room) return;

      const message = sanitizeChatMessage(payload?.message || "");
      if (!message) return;

      const sender = room.participants.find((participant) => participant.socketId === socket.id);
      const chatMessage = {
        roomId,
        name: sanitizeName(payload?.name || sender?.name),
        message,
        ts: Number(payload?.ts || Date.now()),
        socketId: socket.id,
      };

      addChatMessage(room, chatMessage);
      io.to(roomId).emit("chat:message", chatMessage);
    });

    socket.on("sync:ping", (payload: { roomId?: string; time?: number; isPlaying?: boolean }) => {
      const roomId = payload?.roomId || "";
      const room = getRoom(roomId);
      if (!room) return;
      if (!isHostSocket(room, socket.id)) return;

      const now = Date.now();
      const hostTime = clampTime(payload?.time ?? getComputedPlaybackTime(room));

      if (shouldIgnoreNearZeroAfterJoin(roomId, socket.id, hostTime, RECONNECT_PING_GUARD_MS)) {
        return;
      }

      const hostPlaying = Boolean(payload?.isPlaying);
      const serverTime = getComputedPlaybackTime(room);
      const drift = Math.abs(hostTime - serverTime);

      room.state.playbackTime = hostTime;
      room.state.isPlaying = hostPlaying;
      room.state.lastUpdateMs = now;

      if (drift > DRIFT_THRESHOLD_SECONDS || now - room.lastSyncBroadcastMs >= SYNC_BROADCAST_INTERVAL_MS) {
        room.lastSyncBroadcastMs = now;
        emitRoomState(io, roomId);
      }
    });

    socket.on("disconnect", () => {
      const priorRoom = getRoomBySocketId(socket.id);
      const priorRoomId = priorRoom?.roomId;
      const disconnectingClientId = getClientIdBySocketId(socket.id);
      const { room, hostDisconnected } = removeSocket(socket.id);
      socketJoinAtMs.delete(socket.id);

      if (!priorRoomId) return;
      if (!room) return;

      if (hostDisconnected && disconnectingClientId === room.hostClientId) {
        const existing = hostGraceTimers.get(priorRoomId);
        if (existing) {
          clearTimeout(existing);
        }

        const timer = setTimeout(() => {
          hostGraceTimers.delete(priorRoomId);
          const activeRoom = getRoom(priorRoomId);
          if (!activeRoom || activeRoom.participants.length === 0) return;
          if (activeRoom.state.hostSocketId) return;

          const nextHost = activeRoom.participants[0];
          activeRoom.hostClientId = nextHost.clientId;
          activeRoom.state.hostSocketId = nextHost.socketId;
          activeRoom.state.lastUpdateMs = Date.now();
          emitParticipants(io, priorRoomId);
          emitRoomState(io, priorRoomId);
        }, HOST_REASSIGN_GRACE_MS);

        hostGraceTimers.set(priorRoomId, timer);
      }

      emitParticipants(io, priorRoomId);
      emitRoomState(io, priorRoomId);
    });
  });

  return io;
}

