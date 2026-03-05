export interface Participant {
  clientId: string;
  socketId: string;
  name: string;
  joinedAtMs: number;
}

export interface ChatMessage {
  roomId: string;
  name: string;
  message: string;
  ts: number;
  socketId: string;
}

export interface RoomState {
  videoUrl: string | null;
  isPlaying: boolean;
  playbackTime: number;
  playbackRate: number;
  lastUpdateMs: number;
  hostSocketId: string;
  allowAllControls: boolean;
}

export interface Room {
  roomId: string;
  hostClientId: string;
  participants: Participant[];
  state: RoomState;
  chat: ChatMessage[];
  lastSyncBroadcastMs: number;
}
