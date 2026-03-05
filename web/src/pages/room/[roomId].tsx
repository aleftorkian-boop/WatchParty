import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import Chat from "../../components/Chat";
import Controls from "../../components/Controls";
import Participants from "../../components/Participants";
import Player from "../../components/Player";
import { getClientId, getSocket } from "../../lib/socket";
import type { ChatMessage, ParticipantsPayload, Participant, ResolvedKind, RoomState } from "../../lib/types";

const ROOM_ID_REGEX = /^[a-zA-Z0-9-]{3,32}$/;

function getStoredName(): string {
  if (typeof window === "undefined") return "Guest";
  const existing = window.localStorage.getItem("watch-party-name");
  if (existing?.trim()) return existing;
  const generated = `Guest-${Math.random().toString(36).slice(2, 6)}`;
  window.localStorage.setItem("watch-party-name", generated);
  return generated;
}

function extractYouTubeIdFromUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (host === "youtu.be") {
      const candidate = pathParts[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }

    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        const candidate = url.searchParams.get("v") || "";
        return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }

      if (pathParts[0] === "embed" || pathParts[0] === "shorts") {
        const candidate = pathParts[1] || "";
        return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export default function RoomPage() {
  const router = useRouter();
  const roomId = useMemo(() => {
    if (typeof router.query.roomId !== "string") return "";
    return router.query.roomId.trim();
  }, [router.query.roomId]);

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";
  const proxyEnabled = process.env.NEXT_PUBLIC_ENABLE_PROXY !== "false";

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [localTime, setLocalTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const isHost = roomState?.hostSocketId === mySocketId;
  const canControl = Boolean(roomState && (roomState.allowAllControls || isHost));

  useEffect(() => {
    if (!roomId) return;
    if (!ROOM_ID_REGEX.test(roomId)) {
      setErrorMessage("Invalid room ID format");
      return;
    }

    const socket = getSocket();
    const clientId = getClientId();
    const name = getStoredName();

    const onConnect = () => {
      setMySocketId(socket.id || null);
      socket.emit("room:join", { roomId, clientId, name });
    };

    const onRoomState = (payload: RoomState) => setRoomState(payload);
    const onParticipants = (payload: ParticipantsPayload) => {
      if (payload.roomId !== roomId) return;
      setParticipants(payload.participants);
    };
    const onChatMessage = (payload: ChatMessage) => {
      if (payload.roomId !== roomId) return;
      setMessages((prev) => [...prev, payload].slice(-50));
    };

    const onChatHistory = (payload: ChatMessage[]) => setMessages(payload.slice(-50));

    const onError = (msg: string) => setErrorMessage(msg);

    socket.on("connect", onConnect);
    socket.on("room:state", onRoomState);
    socket.on("room:participants", onParticipants);
    socket.on("chat:message", onChatMessage);
    socket.on("room:chat:history", onChatHistory);
    socket.on("error:message", onError);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("room:state", onRoomState);
      socket.off("room:participants", onParticipants);
      socket.off("chat:message", onChatMessage);
      socket.off("room:chat:history", onChatHistory);
      socket.off("error:message", onError);
    };
  }, [roomId]);

  useEffect(() => {
    const socket = getSocket();
    const timer = window.setInterval(() => {
      if (!roomState || !isHost) return;
      socket.emit("sync:ping", {
        roomId,
        time: localTime,
        isPlaying: roomState.isPlaying,
      });
    }, 2_000);

    return () => window.clearInterval(timer);
  }, [isHost, localTime, roomId, roomState]);

  function emit(event: string, payload: Record<string, unknown>) {
    const socket = getSocket();
    socket.emit(event, payload);
  }

  function expectedTimeFromState(state: RoomState | null): number {
    if (!state) return 0;
    if (!state.isPlaying) return state.playbackTime;
    return state.playbackTime + (Date.now() - state.lastUpdateMs) / 1000;
  }

  function handleLoad(rawUrl: string, useProxyChecked: boolean, kind?: ResolvedKind, videoId?: string) {
    if (!canControl || !roomState) return;
    const isYouTubeSource = kind === "youtube" || Boolean(videoId);
    const finalUrl =
      !isYouTubeSource && proxyEnabled && useProxyChecked
        ? `${serverUrl}/stream?url=${encodeURIComponent(rawUrl)}`
        : rawUrl;
    emit("video:set", { roomId, url: finalUrl });
    setErrorMessage(null);
  }

  function handlePlayAction() {
    if (!canControl) return;
    emit("player:play", { roomId, atTime: localTime });
  }

  function handlePauseAction() {
    if (!canControl) return;
    emit("player:pause", { roomId, atTime: localTime });
  }

  function handleTogglePlay() {
    if (!roomState?.isPlaying) {
      handlePlayAction();
      return;
    }
    handlePauseAction();
  }

  async function copyRoomLink() {
    try {
      const link = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
      await window.navigator.clipboard.writeText(link);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }

    window.setTimeout(() => setCopyStatus("idle"), 1400);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === "Space" || event.key === " ";
      if (!isSpace) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        Boolean(target?.isContentEditable);
      if (isTypingTarget) return;

      if (!canControl || !roomState) return;
      event.preventDefault();

      if (roomState.isPlaying) {
        handlePauseAction();
      } else {
        handlePlayAction();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canControl, localTime, roomState]);

  if (!roomId) {
    return <main className="container">Loading room...</main>;
  }

  return (
    <main className="container room-page">
      <header className="panel room-header">
        <div>
          <h1>Room: {roomId}</h1>
          <p>
            Host: {roomState?.hostSocketId ? `${roomState.hostSocketId.slice(0, 8)}...` : "waiting"}
            {isHost ? " (you)" : ""}
          </p>
        </div>
        <button onClick={copyRoomLink}>Copy Room Link</button>
      </header>
      {copyStatus === "copied" ? <p className="hint">Room link copied.</p> : null}
      {copyStatus === "failed" ? <p className="error">Could not copy room link.</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      <section className="player-top">
        <Player
          sourceUrl={roomState?.videoUrl ?? null}
          sourceKind={extractYouTubeIdFromUrl(roomState?.videoUrl ?? null) ? "youtube" : undefined}
          sourceVideoId={extractYouTubeIdFromUrl(roomState?.videoUrl ?? null) || undefined}
          isPlaying={Boolean(roomState?.isPlaying)}
          expectedTime={expectedTimeFromState(roomState)}
          playbackRate={roomState?.playbackRate ?? 1}
          canControl={canControl}
          onTimeUpdate={setLocalTime}
          onPlayRequest={(atTime) => canControl && emit("player:play", { roomId, atTime })}
          onPauseRequest={(atTime) => canControl && emit("player:pause", { roomId, atTime })}
          onSeekRequest={(toTime) => canControl && emit("player:seek", { roomId, toTime })}
        />
      </section>

      <Controls
        isHost={Boolean(isHost)}
        canControl={canControl}
        allowAllControls={roomState?.allowAllControls ?? false}
        proxyEnabled={proxyEnabled}
        currentTime={localTime}
        playbackRate={roomState?.playbackRate ?? 1}
        isPlaying={Boolean(roomState?.isPlaying)}
        onLoad={handleLoad}
        onTogglePlay={handleTogglePlay}
        onSeek={(toTime) => emit("player:seek", { roomId, toTime })}
        onRate={(rate) => emit("player:rate", { roomId, rate })}
        onToggleAllowAll={(allowAllControls) => emit("controls:toggle", { roomId, allowAllControls })}
      />

      <section className="bottom-grid">
        <Participants
          participants={participants}
          hostSocketId={roomState?.hostSocketId ?? null}
          mySocketId={mySocketId}
          canTransferHost={Boolean(isHost)}
          onTransferHost={(toSocketId) => emit("host:transfer", { roomId, toSocketId })}
        />
        <Chat
          messages={messages}
          onSend={(message) => {
            const name = getStoredName();
            emit("chat:message", { roomId, name, message, ts: Date.now() });
          }}
        />
      </section>
    </main>
  );
}
