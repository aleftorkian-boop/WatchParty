import type { Participant } from "../lib/types";

interface ParticipantsProps {
  participants: Participant[];
  hostSocketId: string | null;
  mySocketId: string | null;
  canTransferHost: boolean;
  onTransferHost: (socketId: string) => void;
}

export default function Participants({
  participants,
  hostSocketId,
  mySocketId,
  canTransferHost,
  onTransferHost,
}: ParticipantsProps) {
  return (
    <section className="panel participants-panel">
      <h3>Participants ({participants.length})</h3>
      <ul className="participants-list">
        {participants.map((participant) => {
          const isHost = participant.socketId === hostSocketId;
          return (
            <li key={participant.socketId}>
              <span>
                {participant.name}
                {participant.socketId === mySocketId ? " (you)" : ""}
                {isHost ? " [host]" : ""}
              </span>
              {canTransferHost && !isHost ? (
                <button onClick={() => onTransferHost(participant.socketId)}>Make host</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
