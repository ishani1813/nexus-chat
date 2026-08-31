import { useState } from "react";
import { ROOM_META } from "../utils/helpers";
import { register, login, saveSession } from "../utils/api";
import type { ConnState, RoomId } from "../types";
import type { AuthResult } from "../utils/api";

interface JoinScreenProps {
  rooms: RoomId[];
  onJoin: (auth: AuthResult, room: RoomId) => void;
  connState: ConnState;
}

export function JoinScreen({ rooms, onJoin, connState }: JoinScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState<RoomId>("general");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (connState !== "connected") { setError("Not connected yet — please wait."); return; }
    if (!username.trim() || !password) { setError("Enter a username and password."); return; }

    setError("");
    setSubmitting(true);
    try {
      const auth = mode === "login"
        ? await login(username.trim(), password)
        : await register(username.trim(), password);
      saveSession(auth);
      onJoin(auth, room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = connState === "connected";

  return (
    <div style={{
      minHeight: "100vh", background: "#0c0e17",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "#13151f",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 18, padding: "36px 32px",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "linear-gradient(135deg,#5b63f8,#7c6af7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, margin: "0 auto 14px",
          }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e2e4ef", marginBottom: 4 }}>NexusChat</h1>
          <p style={{ fontSize: 13, color: "#4b5063" }}>Real-time · Compressed · &lt;250ms</p>
        </div>

        {/* Connection status bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 8, padding: "8px 12px", marginBottom: 20,
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: ready ? "#4caf7d" : "#f0a500",
            boxShadow: ready ? "0 0 6px #4caf7d" : "none",
          }} />
          <span style={{ fontSize: 12, color: ready ? "#4caf7d" : "#f0a500" }}>
            {ready ? "Server connected" : `${connState}…`}
          </span>
        </div>

        {/* Login / Register toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: 4 }}>
          {(["login", "register"] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                background: mode === m ? "rgba(91,99,248,0.25)" : "transparent",
                color: mode === m ? "#c2c6fb" : "#6b7280",
                fontSize: 13, fontWeight: 600, transition: "all .15s",
              }}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        {/* Username */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, marginBottom: 7 }}>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder={mode === "register" ? "3-20 letters, numbers, _" : "Your username…"}
            maxLength={20}
            autoFocus
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = "rgba(91,99,248,0.55)"}
            onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, marginBottom: 7 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password…"}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = "rgba(91,99,248,0.55)"}
            onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
          />
          {error && <p style={{ fontSize: 12, color: "#e55", marginTop: 7 }}>{error}</p>}
        </div>

        {/* Room picker */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ display: "block", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, marginBottom: 8 }}>
            Join channel
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {rooms.map(r => {
              const meta = ROOM_META[r] || { icon: "💬", desc: "" };
              const sel = r === room;
              return (
                <button key={r} onClick={() => setRoom(r)} style={{
                  padding: "10px 12px", borderRadius: 9, textAlign: "left", cursor: "pointer",
                  border: sel ? "1.5px solid rgba(91,99,248,0.6)" : "1px solid rgba(255,255,255,0.07)",
                  background: sel ? "rgba(91,99,248,0.12)" : "rgba(255,255,255,0.03)",
                  transition: "all .15s",
                }}>
                  <div style={{ fontSize: 17, marginBottom: 3 }}>{meta.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: sel ? "#a5a9f7" : "#9ba0b8" }}>#{r}</div>
                  <div style={{ fontSize: 10, color: "#4b5063", marginTop: 1 }}>{meta.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!ready || submitting}
          style={{
            width: "100%", padding: "13px",
            borderRadius: 10, border: "none",
            background: ready && !submitting ? "linear-gradient(135deg,#5b63f8,#7c6af7)" : "rgba(255,255,255,0.07)",
            color: ready && !submitting ? "#fff" : "#555",
            fontSize: 14, fontWeight: 600,
            cursor: ready && !submitting ? "pointer" : "not-allowed",
            transition: "opacity .2s",
          }}
        >
          {!ready ? "Waiting for connection…" : submitting ? "Please wait…" : mode === "login" ? "Log in →" : "Create account →"}
        </button>

        <p style={{ fontSize: 11, color: "#3b3f52", textAlign: "center", marginTop: 16 }}>
          200+ concurrent users · WebSocket compression · ACK delivery
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#e2e4ef",
  fontSize: 14, outline: "none",
};
