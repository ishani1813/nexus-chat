// ── Time ─────────────────────────────────────────────────────────────────────
export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
const COLORS = [
  { bg: "#e8eafe", text: "#4a52c9" },
  { bg: "#e1f5ee", text: "#0f6e56" },
  { bg: "#faece7", text: "#993c1d" },
  { bg: "#fbeaf0", text: "#99355b" },
  { bg: "#eaf3de", text: "#3b6d11" },
  { bg: "#faeeda", text: "#854f0b" },
];

export function avatarColor(username = "") {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

export function initials(username = "") {
  const p = username.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

// ── Message grouping ──────────────────────────────────────────────────────────
export function shouldGroup(prev, cur) {
  if (!prev || prev.type === "system" || cur.type === "system") return false;
  if (prev.userId !== cur.userId) return false;
  return new Date(cur.timestamp) - new Date(prev.timestamp) < 60_000;
}

// ── Misc ──────────────────────────────────────────────────────────────────────
export function genClientId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const ROOM_META = {
  general    : { icon: "💬", desc: "General discussion" },
  engineering: { icon: "⚙️",  desc: "Tech & engineering" },
  random     : { icon: "🎲", desc: "Anything goes" },
  design     : { icon: "🎨", desc: "Design & UX" },
};
