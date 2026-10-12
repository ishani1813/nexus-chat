// loadtest.mjs — authenticated WebSocket load test for NexusChat.
//
// Usage:   node loadtest.mjs [numClients] [durationSec] [sendIntervalMs]
// Example: node loadtest.mjs 200 20 2500
//
// Start the server with BENCHMARK_MODE=1 first (relaxes the per-IP auth rate
// limiter so 200 bot users can register from one machine). Never set that
// flag on a deployed server.
//
// What it measures (all in one process, so one clock):
//   - join latency        : join sent -> "joined" reply
//   - ack RTT             : message sent -> message_ack (sender side)
//   - delivery latency    : message sent -> arrives at ANOTHER client in the room
//   - sustained msgs/hour : acked unique messages, scaled to one hour
//
// Exits non-zero if most messages are not acked, so a broken run can't pass
// as a good result.

import WebSocket from "ws";

const NUM_CLIENTS = parseInt(process.argv[2] || "200", 10);
const DURATION_MS = parseInt(process.argv[3] || "20", 10) * 1000;
const SEND_EVERY_MS = parseInt(process.argv[4] || "2500", 10);
const HOST = process.env.HOST || "localhost:4000";
const HTTP = `http://${HOST}`;
const WS_URL = `ws://${HOST}`;
const ROOMS = ["general", "engineering", "random", "design"];
const PASSWORD = "loadtest-pass-123";
const MARK = /LT:(\d+):(\d+)/;

const stats = {
  connected: 0,
  joined: 0,
  socketErrors: 0,
  serverErrors: 0,
  firstServerError: null,
  sent: 0,
  acked: 0,
  deliveries: 0,
  joinLat: [],
  ackLat: [],
  deliveryLat: [],
  types: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const avg = (arr) =>
  arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

// Register the bot the first time, log in on later runs.
async function getToken(username) {
  for (const path of ["register", "login"]) {
    const res = await fetch(`${HTTP}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (res.status === 429) {
      throw new Error(
        "Auth rate limited (429). Start the server with BENCHMARK_MODE=1."
      );
    }
    if (res.ok) {
      const body = await res.json();
      const token = body.token ?? body.jwt ?? body.accessToken;
      if (token) return token;
    }
  }
  throw new Error(`Could not get a token for ${username}`);
}

function startClient(i, token) {
  const ws = new WebSocket(WS_URL);
  const room = ROOMS[i % ROOMS.length];
  const pending = []; // send timestamps, FIFO (WebSocket preserves order)
  let joinSentAt = 0;
  let joinedSeen = false;
  let startTimer = null;
  let sendTimer = null;

  ws.on("open", () => {
    stats.connected++;
    joinSentAt = Date.now();
    ws.send(JSON.stringify({ type: "join", token, room }));

    startTimer = setTimeout(() => {
      sendTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        pending.push(now);
        ws.send(
          JSON.stringify({
            type: "message",
            content: `LT:${i}:${now} load test message`,
            clientMsgId: `${i}-${now}`,
          })
        );
        stats.sent++;
      }, SEND_EVERY_MS + Math.random() * 500);
    }, 500 + Math.random() * 500);
  });

  ws.on("message", (raw) => {
    const text = raw.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    stats.types[msg.type] = (stats.types[msg.type] || 0) + 1;

    if (msg.type === "joined" && !joinedSeen) {
      joinedSeen = true;
      stats.joined++;
      stats.joinLat.push(Date.now() - joinSentAt);
    } else if (msg.type === "message_ack") {
      const sentAt = pending.shift();
      if (sentAt) {
        stats.ackLat.push(Date.now() - sentAt);
        stats.acked++;
      }
    } else if (msg.type === "message") {
      const m = text.match(MARK);
      if (m && Number(m[1]) !== i) {
        stats.deliveryLat.push(Date.now() - Number(m[2]));
        stats.deliveries++;
      }
    } else if (msg.type === "error") {
      stats.serverErrors++;
      if (!stats.firstServerError) stats.firstServerError = text.slice(0, 200);
    }
  });

  ws.on("error", () => {
    stats.socketErrors++;
  });

  return {
    stop() {
      clearTimeout(startTimer);
      clearInterval(sendTimer);
      try {
        ws.close();
      } catch {}
    },
  };
}

async function main() {
  console.log(`Getting tokens for ${NUM_CLIENTS} bot users (first run registers them)...`);
  const tokens = [];
  for (let b = 0; b < NUM_CLIENTS; b += 10) {
    const n = Math.min(10, NUM_CLIENTS - b);
    const batch = await Promise.all(
      Array.from({ length: n }, (_, k) => getToken(`ltbot${b + k}`))
    );
    tokens.push(...batch);
  }

  console.log(`Spawning ${NUM_CLIENTS} authenticated clients for ${DURATION_MS / 1000}s...`);
  const startedAt = Date.now();
  const clients = tokens.map((t, i) => startClient(i, t));

  await sleep(DURATION_MS);

  // Grab server metrics while clients are still connected.
  const serverMetrics = await fetch(`${HTTP}/api/metrics`)
    .then((r) => r.json())
    .catch(() => null);

  const wallSec = (Date.now() - startedAt) / 1000;
  clients.forEach((c) => c.stop());
  await sleep(300);

  const msgsPerHour = Math.round(stats.acked / (wallSec / 3600));

  console.log("\n=== LOAD TEST RESULTS (measured) ===");
  console.log(`Clients requested:          ${NUM_CLIENTS}`);
  console.log(`Peak connected:             ${stats.connected}`);
  console.log(`Joined (got "joined"):      ${stats.joined}`);
  console.log(`Socket errors:              ${stats.socketErrors}`);
  console.log(`Server error messages:      ${stats.serverErrors}`);
  console.log(
    `Join latency (ms):          avg=${avg(stats.joinLat)}  p50=${pct(stats.joinLat, 50)}  p95=${pct(stats.joinLat, 95)}`
  );
  console.log(
    `Ack RTT (ms):               avg=${avg(stats.ackLat)}  p50=${pct(stats.ackLat, 50)}  p95=${pct(stats.ackLat, 95)}  p99=${pct(stats.ackLat, 99)}`
  );
  console.log(
    `Delivery latency (ms):      avg=${avg(stats.deliveryLat)}  p50=${pct(stats.deliveryLat, 50)}  p95=${pct(stats.deliveryLat, 95)}  p99=${pct(stats.deliveryLat, 99)}`
  );
  console.log(`Messages sent / acked:      ${stats.sent} / ${stats.acked}`);
  console.log(`Broadcast deliveries seen:  ${stats.deliveries}`);
  console.log(`Wall time (s):              ${wallSec.toFixed(1)}`);
  console.log(`Sustained unique msgs/hour: ${msgsPerHour}`);
  console.log(`Message types seen:         ${JSON.stringify(stats.types)}`);
  if (stats.firstServerError) {
    console.log(`First server error:         ${stats.firstServerError}`);
  }
  console.log("\nServer-reported /api/metrics:");
  console.log(JSON.stringify(serverMetrics, null, 2));

  const ok = stats.sent > 0 && stats.acked >= stats.sent * 0.9;
  if (!ok) {
    console.error(
      "\nFAILED: fewer than 90% of messages were acked. Do not use these numbers."
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Load test aborted:", err.message);
  process.exit(1);
});
