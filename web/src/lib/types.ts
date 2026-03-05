export interface RoomState {
  videoUrl: string | null;
  isPlaying: boolean;
  playbackTime: number;
  playbackRate: number;
  lastUpdateMs: number;
  hostSocketId: string;
  allowAllControls: boolean;
}

export interface Participant {
  socketId: string;
  name: string;
}

export interface ParticipantsPayload {
  roomId: string;
  hostSocketId: string;
  participants: Participant[];
}

export interface ChatMessage {
  roomId: string;
  name: string;
  message: string;
  ts: number;
  socketId: string;
}

export interface ParsedVideoUrl {
  normalizedUrl: string;
  isHls: boolean;
  isDirectFile: boolean;
  shouldPreferProxy: boolean;
}

export type ResolvedKind = "youtube" | "mp4" | "webm" | "hls" | "unknown";

