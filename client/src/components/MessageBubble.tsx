import { Avatar } from "./Avatar";
import { formatTime, shouldGroup } from "../utils/helpers";
import type { ChatMessage, DeliveryStatus } from "../types";

const DELIVERY_MAP: Record<DeliveryStatus, { icon: string; color: string }> = {
  sending: { icon: "⋯", color: "#888" },
  sent: { icon: "✓", color: "#7db5f0" },
  delivered: { icon: "✓✓", color: "#4caf7d" },
  failed: { icon: "✗", color: "#e55" },
};

function DeliveryBadge({ status }: { status?: DeliveryStatus }) {
  const s = status ? DELIVERY_MAP[status] : undefined;
  if (!s) return null;
  return <span style={{ fontSize: 10, color: s.color, marginTop: 2 }}>{s.icon}</span>;
}

interface MessageBubbleProps {
  message: ChatMessage;
  prevMessage?: ChatMessage;
  myId: string | null;
}

export function MessageBubble({ message, prevMessage, myId }: MessageBubbleProps) {
  // ── system event ─────────────────────────────────────────────────────────────
  if (message.type === "system") {
    return (
      <div style={{ textAlign: "center", padding: "6px 0" }}>
        <span style={{
          fontSize: 11, color: "#8a8fa8",
          background: "rgba(138,143,168,0.08)",
          padding: "3px 12px", borderRadius: 99,
        }}>
          {message.content}
        </span>
      </div>
    );
  }

  const isMine = message.userId === myId || message.isMine;
  const grouped = shouldGroup(prevMessage, message);

  return (
    <div style={{
      display: "flex",
      flexDirection: isMine ? "row-reverse" : "row",
      alignItems: "flex-end",
      gap: 8,
      paddingTop: grouped ? 2 : 14,
    }}>
      {/* Avatar col — only show for first in a group */}
      <div style={{ width: 32, flexShrink: 0 }}>
        {!isMine && !grouped && <Avatar username={message.username} size={32} />}
      </div>

      <div style={{
        maxWidth: "66%",
        display: "flex", flexDirection: "column",
        alignItems: isMine ? "flex-end" : "flex-start",
        gap: 3,
      }}>
        {/* Name + time row */}
        {!grouped && (
          <div style={{
            display: "flex", gap: 7, alignItems: "baseline",
            flexDirection: isMine ? "row-reverse" : "row",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#c5c9d8" }}>
              {isMine ? "You" : message.username}
            </span>
            <span style={{ fontSize: 10, color: "#565b72" }}>
              {formatTime(message.timestamp)}
            </span>
          </div>
        )}

        {/* Bubble */}
        <div style={{
          padding: "9px 13px",
          borderRadius: isMine ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
          background: isMine
            ? "linear-gradient(135deg,#5b63f8 0%,#7c6af7 100%)"
            : "rgba(255,255,255,0.06)",
          border: isMine ? "none" : "1px solid rgba(255,255,255,0.07)",
          color: isMine ? "#fff" : "#d8dbe8",
          fontSize: 14, lineHeight: 1.5,
          wordBreak: "break-word",
          boxShadow: isMine ? "0 2px 12px rgba(91,99,248,0.25)" : "none",
        }}>
          {message.content}
        </div>

        {/* Delivery status (own messages only) */}
        {isMine && <DeliveryBadge status={message.deliveryStatus} />}
      </div>
    </div>
  );
}
