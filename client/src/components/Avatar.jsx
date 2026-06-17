import { avatarColor, initials } from "../utils/helpers";

export function Avatar({ username, size = 32, showDot = false }) {
  const { bg, text } = avatarColor(username);
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: bg, color: text,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.37, fontWeight: 700, userSelect: "none",
      }}>
        {initials(username)}
      </div>
      {showDot && (
        <div style={{
          position: "absolute", bottom: 0, right: 0,
          width: size * 0.28, height: size * 0.28,
          borderRadius: "50%", background: "#4caf7d",
          border: `2px solid #0f1117`,
        }} />
      )}
    </div>
  );
}
