import { FormEvent, useState } from "react";
import type { ChatMessage } from "../lib/types";

interface ChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
}

export default function Chat({ messages, onSend }: ChatProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    onSend(next.slice(0, 500));
    setDraft("");
  }

  return (
    <section className="panel chat-panel">
      <h3>Chat</h3>
      <div className="chat-list">
        {messages.map((item, idx) => (
          <div key={`${item.ts}-${idx}`} className="chat-item">
            <span className="chat-name">{item.name}</span>
            <p>{item.message}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="chat-form">
        <input
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message"
        />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
