import { useState, useEffect, type ReactNode } from "react";
import { formatUptime } from "../utils/helpers";
import type { Metrics } from "../types";

// This dashboard only ever renders values that came from the server's real
// getMetrics() (server/src/server.ts) — connectedUsers, avgLatency,
// compressionRatio, successfulDeliveries/failedDeliveries, msgsPerHour,
// uptimeSeconds. It arrives roughly every 15s via the WebSocket ping/pong
// loop (see useWebSocket.ts). Nothing here is randomly generated or
// hardcoded to a fixed "impressive" number — before the first metrics
// snapshot arrives, cards show "—" rather than a placeholder guess.

const HISTORY_LEN = 20;

// ── Tiny sparkline (no lib needed) ────────────────────────────────────────────
interface SparkProps {
  data: number[];
  color: string;
  height?: number;
}

function Spark({ data, color, height = 40 }: SparkProps) {
  if (!data || data.length < 2) return null;
  const W = 200, H = height;
  const min = Math.min(...data), max = Math.max(...data) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / (max - min || 1)) * H * 0.85 - H * 0.08;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = [...pts, `${W},${H}`, `0,${H}`].join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <polygon points={area} fill={color} fillOpacity={0.1} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string | number;
  accent?: string;
  sparkData?: number[];
  sparkColor?: string;
}

function KpiCard({ label, value, accent, sparkData, sparkColor }: KpiCardProps) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent || "#e2e4ef", letterSpacing: "-.02em", lineHeight: 1 }}>{value}</div>
      {sparkData && sparkData.length >= 2 && <div style={{ marginTop: 8 }}><Spark data={sparkData} color={sparkColor || "#5b63f8"} /></div>}
    </div>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10, padding: "16px",
    }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, fontWeight: 500 }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyChartState() {
  return (
    <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#3b3f52" }}>
      Waiting for first metrics update (~15s)…
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface MetricsDashboardProps {
  metrics: Metrics | null;
  onBack: () => void;
}

export function MetricsDashboard({ metrics, onBack }: MetricsDashboardProps) {
  const [latHist, setLatHist] = useState<number[]>([]);
  const [msgsHist, setMsgsHist] = useState<number[]>([]);
  const [compHist, setCompHist] = useState<number[]>([]);

  // Push a new real sample only when a genuinely new metrics snapshot
  // arrives from the server (every ~15s via ping/pong) — never on a timer
  // of our own, and never with a fabricated value.
  useEffect(() => {
    if (!metrics) return;
    setLatHist(prev => [...prev.slice(-(HISTORY_LEN - 1)), metrics.avgLatency]);
    setMsgsHist(prev => [...prev.slice(-(HISTORY_LEN - 1)), metrics.msgsPerHour]);
    setCompHist(prev => [...prev.slice(-(HISTORY_LEN - 1)), metrics.compressionRatio]);
    // metrics is a new object each time the server sends one, so this
    // effect intentionally re-runs on every snapshot, not just on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  const totalDeliveries = (metrics?.successfulDeliveries ?? 0) + (metrics?.failedDeliveries ?? 0);
  const deliveryRate = totalDeliveries > 0
    ? `${((metrics!.successfulDeliveries / totalDeliveries) * 100).toFixed(1)}%`
    : "—";

  return (
    <div style={{
      flex: 1, overflowY: "auto", background: "#0c0e17",
      padding: "20px 18px", fontFamily: "inherit", minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e4ef", marginBottom: 3 }}>Performance Dashboard</div>
          <div style={{ fontSize: 12, color: "#4b5063" }}>NexusChat · WebSocket · Node.js · React — live server metrics, polled every 15s</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(76,175,61,0.1)", color: "#4caf7d", fontSize: 11, padding: "4px 10px", borderRadius: 99 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4caf7d", animation: "lp 2s ease-in-out infinite" }} />
            Live
          </div>
          <button onClick={onBack} style={{ fontSize: 12, color: "#9ba0b8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>
            ← Back to chat
          </button>
        </div>
      </div>

      {/* KPI grid — every value below is metrics.<field> straight from the server, or "—" if not yet received */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard label="Messages / hr" value={metrics ? metrics.msgsPerHour.toLocaleString() : "—"} sparkData={msgsHist} sparkColor="#5b63f8" />
        <KpiCard label="Avg latency" value={metrics ? `${metrics.avgLatency}ms` : "—"} accent="#4caf7d" sparkData={latHist} sparkColor="#4caf7d" />
        <KpiCard label="Compression" value={metrics ? `${metrics.compressionRatio}%` : "—"} accent="#7c6af7" sparkData={compHist} sparkColor="#7c6af7" />
        <KpiCard label="Concurrent users" value={metrics?.connectedUsers ?? "—"} />
        <KpiCard label="Delivery rate" value={deliveryRate} />
        <KpiCard label="Uptime" value={metrics ? formatUptime(metrics.uptimeSeconds) : "—"} />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginBottom: 14 }}>
        <ChartCard title="WebSocket latency over time (ms)">
          {latHist.length >= 2 ? (
            <>
              <Spark data={latHist} color="#5b63f8" height={90} />
              <div style={{ fontSize: 10, color: "#4b5063", marginTop: 6 }}>
                Current: <span style={{ color: "#4caf7d" }}>{latHist[latHist.length - 1]}ms</span> · last {latHist.length} snapshots
              </div>
            </>
          ) : <EmptyChartState />}
        </ChartCard>

        <ChartCard title="Compression ratio over time (%)">
          {compHist.length >= 2 ? (
            <>
              <Spark data={compHist} color="#7c6af7" height={90} />
              <div style={{ fontSize: 10, color: "#4b5063", marginTop: 6 }}>
                Current: <span style={{ color: "#a5a9f7" }}>{compHist[compHist.length - 1]}%</span> bandwidth saved
              </div>
            </>
          ) : <EmptyChartState />}
        </ChartCard>
      </div>

      {metrics && (
        <div style={{ fontSize: 11, color: "#3b3f52", textAlign: "center", marginTop: 12 }}>
          {metrics.totalMessages.toLocaleString()} total messages · {metrics.activeRooms} active room{metrics.activeRooms === 1 ? "" : "s"}
        </div>
      )}
      <style>{`@keyframes lp{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
