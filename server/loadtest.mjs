// loadtest.mjs — measures real concurrency/latency/throughput against the
// running NexusChat server. Run with: node loadtest.mjs [numClients] [durationSec]
import WebSocket from "ws";

const NUM_CLIENTS = parseInt(process.argv[2] || "200", 10);
const DURATION_MS = parseInt(process.argv[3] || "20", 10) * 1000;
const ROOMS = ["general", "engineering", "random", "design"];
const URL = "ws://localhost:4000";

let connected = 0;
let joinAckLatencies = [];
let messageRTTs = [];
let messagesSent = 0;
let messagesAcked = 0;
let errors = 0;

function client(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const room = ROOMS[i % ROOMS.length];
    let pendingSendTs = null;

    ws.on("open", () => {
      connected++;
      const t0 = Date.now();
      ws.send(JSON.stringify({ type: "join", room, username: `loadtest_${i}` }));
      ws.once("message", () => {
        joinAckLatencies.push(Date.now() - t0);
      });
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "message_ack" && pendingSendTs) {
          messageRTTs.push(Date.now() - pendingSendTs);
          messagesAcked++;
          pendingSendTs = null;
        }
      } catch {}
    });

    ws.on("error", () => { errors++; });

    const sendInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        pendingSendTs = Date.now();
        ws.send(JSON.stringify({ type: "message", content: `load test message from client ${i} at ${Date.now()}`, clientMsgId: `${i}-${Date.now()}` }));
        messagesSent++;
      }
    }, 2000 + Math.random() * 1000); // stagger sends ~2-3s per client

    setTimeout(() => {
      clearInterval(sendInterval);
      ws.close();
      resolve();
    }, DURATION_MS);
  });
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

(async () => {
  console.log(`Spawning ${NUM_CLIENTS} concurrent WS clients for ${DURATION_MS / 1000}s...`);
  const start = Date.now();
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients.push(client(i));
    await new Promise((r) => setTimeout(r, 5)); // ramp-up to avoid connection-storm errors
  }
  await Promise.all(clients);
  const wallSec = (Date.now() - start) / 1000;

  const metricsRes = await fetch("http://localhost:4000/api/metrics");
  const serverMetrics = await metricsRes.json();

  console.log("\n=== LOAD TEST RESULTS (measured, not assumed) ===");
  console.log(`Clients requested:        ${NUM_CLIENTS}`);
  console.log(`Peak connected:           ${connected}`);
  console.log(`Connection errors:        ${errors}`);
  console.log(`Join ACK latency (ms):    avg=${(joinAckLatencies.reduce((a,b)=>a+b,0)/joinAckLatencies.length || 0).toFixed(1)}  p50=${pct(joinAckLatencies,0.5)}  p95=${pct(joinAckLatencies,0.95)}`);
  console.log(`Message RTT (ms):         avg=${(messageRTTs.reduce((a,b)=>a+b,0)/messageRTTs.length || 0).toFixed(1)}  p50=${pct(messageRTTs,0.5)}  p95=${pct(messageRTTs,0.95)}`);
  console.log(`Messages sent/acked:      ${messagesSent} / ${messagesAcked}`);
  console.log(`Wall time (s):            ${wallSec.toFixed(1)}`);
  console.log(`Extrapolated msgs/hour:   ${Math.round((messagesAcked / wallSec) * 3600)}`);
  console.log(`\nServer-reported /api/metrics:`);
  console.log(JSON.stringify(serverMetrics, null, 2));
})();
