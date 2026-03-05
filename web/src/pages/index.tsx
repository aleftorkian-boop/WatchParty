import { useRouter } from "next/router";
import { FormEvent, useMemo, useState } from "react";

const ROOM_ID_REGEX = /^[a-zA-Z0-9-]{3,32}$/;

function makeRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function HomePage() {
  const router = useRouter();
  const [roomIdInput, setRoomIdInput] = useState("");
  const cleanedRoomId = useMemo(() => roomIdInput.trim(), [roomIdInput]);

  function navigateToRoom(roomId: string) {
    router.push(`/room/${encodeURIComponent(roomId)}`);
  }

  function handleCreate() {
    const roomId = cleanedRoomId || makeRoomId();
    if (!ROOM_ID_REGEX.test(roomId)) {
      alert("Room ID must be 3-32 chars: letters, numbers, dashes");
      return;
    }
    navigateToRoom(roomId);
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!ROOM_ID_REGEX.test(cleanedRoomId)) {
      alert("Enter a valid Room ID to join");
      return;
    }
    navigateToRoom(cleanedRoomId);
  }

  return (
    <main className="container center">
      <section className="panel card">
        <h1>Watch Party</h1>
        <p>Watch videos in sync with friends.</p>
        <form onSubmit={handleJoin} className="stack-sm">
          <label htmlFor="room-id">Room ID (optional for Create room)</label>
          <input
            id="room-id"
            value={roomIdInput}
            onChange={(event) => setRoomIdInput(event.target.value)}
            placeholder="my-room"
          />
          <div className="row gap">
            <button type="button" onClick={handleCreate}>
              Create room
            </button>
            <button type="submit">Join room</button>
          </div>
        </form>
      </section>
    </main>
  );
}

