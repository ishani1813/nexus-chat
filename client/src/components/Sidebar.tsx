import { Avatar } from "./Avatar";
import { ROOM_META, formatUptime } from "../utils/helpers";
import type { ConnState, Metrics, RoomId, UserSummary } from "../types";

interface MetricPillProps {
  label: string;
  value: string | number;
  accent?: string;
}

function MetricPill({ label, value, accent }: MetricPillProps) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8, padding: "9px 11px",
    }}>
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent || "#e2e4ef", letterSpacing: "-.02em" }}>
        {value}
      </div>
    </div>
  );
}

interface SidebarProps {
  rooms: RoomId[];
  currentRoom: RoomId;
  onRoomSwitch: (room: RoomId) => void;
  users: UserSummary[];
  metrics: Metrics | null;
  connState: ConnState;
  rtt: number | null;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const CONN_COLORS: Record<ConnState, string> = {
  connected: "#4caf7d",
  connecting: "#f0a500",
  reconnecting: "#f0a500",
  disconnected: "#e55",
};

export function Sidebar({
  rooms, currentRoom, onRoomSwitch,
  users, metrics, connState, rtt,
  mobileOpen, onMobileClose,
}: SidebarProps) {
  const connColor = CONN_COLORS[connState] || "#e55";

  const content = (
    <div style={{
      width: 230, height: "100%",
      background: "#0f1117",
      borderRight: "1px solid rgba(255,255,255,0.07)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#5b63f8,#7c6af7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
          ⚡
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#e2e4ef" }}>NexusChat</div>
          <div style={{ fontSize: 10, color: "#4b5063" }}>Real-time messaging</div>
        </div>
        {/* Mobile close */}
        {onMobileClose && (
          <button onClick={onMobileClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* Connection status */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: connColor, boxShadow: connState === "connected" ? `0 0 6px ${connColor}` : "none" }} />
        <span style={{ fontSize: 11, color: connColor, textTransform: "capitalize" }}>{connState}</span>
        {rtt && connState === "connected" && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#4b5063" }}>{rtt}ms</span>
        )}
      </div>

      {/* Channels */}
      <div style={{ padding: "12px 0 6px" }}>
        <div style={{ padding: "0 16px 6px", fontSize: 10, color: "#4b5063", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>
          Channels
        </div>
        {rooms.map(room => {
          const meta = ROOM_META[room] || { icon: "💬", desc: "" };
          const active = room === currentRoom;
          return (
            <button key={room} onClick={() => { onRoomSwitch(room); onMobileClose?.(); }}
              style={{
                width: "100%", padding: "8px 16px",
                display: "flex", alignItems: "center", gap: 8,
                background: active ? "rgba(91,99,248,.14)" : "transparent",
                border: "none", borderLeft: `2px solid ${active ? "#5b63f8" : "transparent"}`,
                cursor: "pointer", color: active ? "#e2e4ef" : "#7b8097",
                textAlign: "left", transition: "all .15s",
              }}>
              <span style={{ fontSize: 15 }}>{meta.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>#{room}</div>
                <div style={{ fontSize: 10, color: "#4b5063" }}>{meta.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Online users */}
      {users.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "10px 0 4px" }}>
          <div style={{ padding: "0 16px 5px", fontSize: 10, color: "#4b5063", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>
            Online — {users.length}
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto" }}>
            {users.map(u => (
              <div key={u.id} style={{ padding: "4px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar username={u.username} size={24} showDot />
                <span style={{ fontSize: 12, color: "#9ba0b8" }}>{u.username}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live metrics */}
      {metrics && (
        <div style={{ marginTop: "auto", padding: "12px 10px 16px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize: 10, color: "#4b5063", textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 600, marginBottom: 8, padding: "0 4px" }}>
            Live metrics
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <MetricPill label="Users" value={metrics.connectedUsers} accent="#5b63f8" />
            <MetricPill label="Latency" value={`${metrics.avgLatency}ms`} accent="#4caf7d" />
            <MetricPill label="Msgs/hr" value={metrics.msgsPerHour >= 1000 ? `${Math.round(metrics.msgsPerHour / 1000)}k` : metrics.msgsPerHour} />
            <MetricPill label="Compr." value={`${metrics.compressionRatio}%`} accent="#7c6af7" />
          </div>
          {metrics.uptimeSeconds != null && (
            <div style={{ fontSize: 10, color: "#4b5063", textAlign: "center", marginTop: 8 }}>
              Uptime: {formatUptime(metrics.uptimeSeconds)}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div style={{ height: "100vh", display: "flex" }} className="sidebar-desktop">
        {content}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          display: "flex",
        }}>
          <div onClick={onMobileClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)" }} />
          <div style={{ height: "100vh" }}>{content}</div>
        </div>
      )}
    </>
  );
}
