import { useRef, useEffect, useState, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";
import { ROOM_META } from "../utils/helpers";
import type { ChatMessage, ConnState, RoomId, TypingUser } from "../types";

function TypingIndicator({ typingUsers }: { typingUsers: TypingUser[] }) {
  if (!typingUsers.length) return <div style={{ height: 22 }} />;
  const label = typingUsers.length === 1
    ? `${typingUsers[0].username} is typing…`
    : `${typingUsers.map(u => u.username).join(", ")} are typing…`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, height: 22 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: "#5b63f8",
            animation: `typingBounce 1.2s ease-in-out ${i * 0.15}s infinite`,
          }} />
        ))}
      </div>
      <span style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>{label}</span>
    </div>
  );
}

interface ChatWindowProps {
  messages: ChatMessage[];
  myId: string | null;
  currentRoom: RoomId;
  typingUsers: TypingUser[];
  onSend: (content: string) => void;
  onTyping: (isTyping: boolean) => void;
  connState: ConnState;
  onMenuOpen: () => void;
}

export function ChatWindow({
  messages, myId, currentRoom,
  typingUsers, onSend, onTyping,
  connState, onMenuOpen,
}: ChatWindowProps) {
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const meta = ROOM_META[currentRoom] || { icon: "💬", desc: "" };
  const canSend = connState === "connected" && input.trim().length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleInput = useCallback((val: string) => {
    setInput(val);
    if (val.trim() && !typing) { setTyping(true); onTyping(true); }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { setTyping(false); onTyping(false); }, 2000);
    if (!val.trim() && typing) { setTyping(false); onTyping(false); }
  }, [typing, onTyping]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(input.trim());
    setInput("");
    clearTimeout(typingTimer.current);
    if (typing) { setTyping(false); onTyping(false); }
    inputRef.current?.focus();
  }, [canSend, input, onSend, typing, onTyping]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", background: "#13151f", overflow: "hidden", minWidth: 0 }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "#0f1117", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
      }}>
        {/* Hamburger (mobile) */}
        <button onClick={onMenuOpen} style={{
          display: "none", background: "none", border: "none",
          color: "#6b7280", fontSize: 20, cursor: "pointer",
          padding: "0 8px 0 0",
        }} className="hamburger">☰</button>

        <span style={{ fontSize: 20 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e4ef" }}>#{currentRoom}</div>
          <div style={{ fontSize: 11, color: "#4b5063" }}>{messages.length} messages · {meta.desc}</div>
        </div>
        {/* Connection badge */}
        <div style={{
          fontSize: 10, padding: "3px 9px", borderRadius: 99,
          background: connState === "connected" ? "rgba(76,175,61,0.12)" : "rgba(229,85,85,0.12)",
          color: connState === "connected" ? "#4caf7d" : "#e55",
        }}>
          {connState}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
        {messages.length === 0 && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#4b5063" }}>
            <div style={{ fontSize: 42 }}>{meta.icon}</div>
            <div style={{ fontWeight: 600, color: "#6b7280" }}>No messages yet</div>
            <div style={{ fontSize: 13 }}>Be the first to say something in #{currentRoom}</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id || msg.clientMsgId || i}
            message={msg}
            prevMessage={messages[i - 1]}
            myId={myId}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      <div style={{ padding: "0 20px 2px" }}>
        <TypingIndicator typingUsers={typingUsers} />
      </div>

      {/* Input */}
      <div style={{ padding: "8px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0f1117", flexShrink: 0 }}>
        <div style={{
          display: "flex", gap: 9, alignItems: "flex-end",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12, padding: "8px 8px 8px 14px",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            placeholder={connState === "connected" ? `Message #${currentRoom}…` : "Connecting…"}
            disabled={connState !== "connected"}
            rows={1}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#e2e4ef", fontSize: 14, lineHeight: 1.5,
              resize: "none", maxHeight: 120, fontFamily: "inherit",
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
          />
          <button onClick={handleSend} disabled={!canSend} style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: canSend ? "linear-gradient(135deg,#5b63f8,#7c6af7)" : "rgba(255,255,255,0.05)",
            border: "none", cursor: canSend ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all .2s",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={canSend ? "#fff" : "#555"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#3b3f52", marginTop: 5, paddingLeft: 2 }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>

      <style>{`
        @keyframes typingBounce { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-4px);opacity:1} }
        @media(max-width:640px){ .hamburger{ display:flex !important; } .sidebar-desktop{ display:none !important; } }
      `}</style>
    </div>
  );
}
