import { Room, RoomState } from "./types";

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();
const socketToClientId = new Map<string, string>();

function makeInitialState(hostSocketId: string): RoomState {
  return {
    videoUrl: null,
    isPlaying: false,
    playbackTime: 0,
    playbackRate: 1,
    lastUpdateMs: Date.now(),
    hostSocketId,
    allowAllControls: false,
  };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomBySocketId(socketId: string): Room | undefined {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return undefined;
  return rooms.get(roomId);
}

export function getClientIdBySocketId(socketId: string): string | null {
  return socketToClientId.get(socketId) ?? null;
}

export function joinRoom(roomId: string, socketId: string, clientId: string, name: string): Room {
  const now = Date.now();
  const room = rooms.get(roomId);

  socketToRoom.set(socketId, roomId);
  socketToClientId.set(socketId, clientId);

  if (!room) {
    const created: Room = {
      roomId,
      hostClientId: clientId,
      participants: [{ clientId, socketId, name, joinedAtMs: now }],
      state: makeInitialState(socketId),
      chat: [],
      lastSyncBroadcastMs: 0,
    };
    rooms.set(roomId, created);
    return created;
  }

  const existing = room.participants.find((participant) => participant.clientId === clientId);
  if (existing) {
    existing.socketId = socketId;
    existing.name = name;
  } else {
    room.participants.push({ clientId, socketId, name, joinedAtMs: now });
  }

  if (room.hostClientId === clientId) {
    room.state.hostSocketId = socketId;
  }

  return room;
}

export function removeSocket(
  socketId: string
): { room: Room | null; removedRoomId: string | null; hostDisconnected: boolean } {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) {
    return { room: null, removedRoomId: null, hostDisconnected: false };
  }

  const clientId = socketToClientId.get(socketId);
  socketToRoom.delete(socketId);
  socketToClientId.delete(socketId);

  const room = rooms.get(roomId);
  if (!room) {
    return { room: null, removedRoomId: roomId, hostDisconnected: false };
  }

  const participant = room.participants.find((item) => item.socketId === socketId);
  if (!participant || participant.clientId !== clientId) {
    return { room, removedRoomId: roomId, hostDisconnected: false };
  }

  room.participants = room.participants.filter((item) => item.socketId !== socketId);

  if (room.participants.length === 0) {
    rooms.delete(roomId);
    return { room: null, removedRoomId: roomId, hostDisconnected: false };
  }

  const hostDisconnected = room.hostClientId === participant.clientId;
  if (hostDisconnected) {
    room.state.hostSocketId = "";
  }

  return { room, removedRoomId: roomId, hostDisconnected };
}

export function isHostSocket(room: Room, socketId: string): boolean {
  const participant = room.participants.find((item) => item.socketId === socketId);
  if (!participant) return false;
  return participant.clientId === room.hostClientId;
}

export function canControl(room: Room, socketId: string): boolean {
  if (room.state.allowAllControls) return true;
  return isHostSocket(room, socketId);
}

export function addChatMessage(room: Room, message: Room["chat"][number]): void {
  room.chat.push(message);
  if (room.chat.length > 50) {
    room.chat.splice(0, room.chat.length - 50);
  }
}

export function getPublicParticipants(room: Room): Array<{ socketId: string; name: string }> {
  return room.participants.map((participant) => ({
    socketId: participant.socketId,
    name: participant.name,
  }));
}

export function getComputedPlaybackTime(room: Room): number {
  if (!room.state.isPlaying) return room.state.playbackTime;
  return room.state.playbackTime + (Date.now() - room.state.lastUpdateMs) / 1000;
}
