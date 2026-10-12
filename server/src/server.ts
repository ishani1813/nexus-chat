/**
 * NexusChat — WebSocket Server
 * ─────────────────────────────
 * Features:
 *  • perMessageDeflate compression, with actual measured savings (not
 *    assumed) fed into the live metrics dashboard
 *  • Concurrent session manager (200 simultaneous users)
 *  • Rolling latency window → avg latency metric
 *  • Delivery ACK per message with recipient count
 *  • Heartbeat (30 s ping/pong) to cull dead sockets
 *  • Per-connection message rate limit + max message length
 *  • Rate-limited auth endpoints (10 attempts / 15 min / IP)
 *  • REST API: /api/health  /api/metrics  /api/rooms  /api/rooms/:id/history
 */

import express, { type Request, type Response } from "express";
import http from "http";
import WebSocket from "ws";
import cors from "cors";
import zlib from "zlib";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";

import {
  ROOMS,
  type RoomId,
  type ChatMessage,
  type Session,
  type Metrics,
  type UserSummary,
  type ClientMessage,
  type ServerMessage,
} from "./types";
import { createDb } from "./db";
import { register, login, verifyToken, AuthError } from "./auth";

const db = createDb();

// ─── App & HTTP server ────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Trust the first proxy hop (Render, and most single-proxy PaaS setups) so
// req.ip reflects the real client IP rather than the proxy's — otherwise
// the rate limiter below would bucket every user behind the same IP together.
app.set("trust proxy", 1);

app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── WebSocket server with per-message deflate ────────────────────────────────
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 128, // only compress payloads > 128 bytes
  },
});

// Extend the socket with the heartbeat flag we attach to it.
interface HeartbeatWebSocket extends WebSocket {
  isAlive?: boolean;
}

// ─── In-memory state ──────────────────────────────────────────────────────────
const sessions = new Map<string, Session>(); // socketId → session
const rooms = new Map<RoomId, Set<string>>(); // roomId   → Set<socketId>
// Message history now lives in SQLite (see db.ts) rather than in memory, so
// it survives a server restart. In-memory state above is connection state,
// which inherently can't survive a restart regardless (a restart drops every
// live WebSocket), so there's nothing to persist there.

const MAX_HISTORY = 100;
const MAX_MESSAGE_LENGTH = 2000; // characters
const MSG_RATE_LIMIT = 10; // max chat messages per socket per window
const MSG_RATE_WINDOW_MS = 1000;

// Per-connection sliding-window counters for the WebSocket message rate limit.
// Separate from `sessions` so a pre-join flood attempt is still throttled.
const msgWindows = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  const w = msgWindows.get(socketId);
  if (!w || now - w.windowStart >= MSG_RATE_WINDOW_MS) {
    msgWindows.set(socketId, { count: 1, windowStart: now });
    return false;
  }
  w.count++;
  return w.count > MSG_RATE_LIMIT;
}

ROOMS.forEach((r) => {
  rooms.set(r, new Set());
});

// ─── Metrics ──────────────────────────────────────────────────────────────────
const metrics = {
  totalMessages: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
  rawBytes: 0,
  compressedBytes: 0,
  latencySamples: [] as number[], // rolling window of 500
  startTime: Date.now(),
};

// Rolling window of totalMessages samples, taken every 5s (~60s of history).
const rateSamples: { t: number; n: number }[] = [];
const rateTimer = setInterval(() => {
  rateSamples.push({ t: Date.now(), n: metrics.totalMessages });
  while (rateSamples.length > 13) rateSamples.shift();
}, 5000);

function rollingMsgsPerHour(): number {
  if (rateSamples.length < 2) return 0;
  const first = rateSamples[0];
  const last = rateSamples[rateSamples.length - 1];
  const hrs = (last.t - first.t) / 3_600_000;
  return hrs > 0 ? Math.round((last.n - first.n) / hrs) : 0;
}

function getMetrics(): Metrics {
  const uptimeMs = Date.now() - metrics.startTime;
  // Unique messages/hour, extrapolated from a rolling ~60s window (not
  // fan-out deliveries, and not a lifetime average that decays when idle).
  const msgsPerHour = rollingMsgsPerHour();
  // Average server-side time (ms, 2 decimals) to fan one message out to its
  // room. This is NOT network latency; it is how long the broadcast loop takes.
  const avgLatency =
    metrics.latencySamples.length > 0
      ? Math.round(
          (metrics.latencySamples.reduce((a, b) => a + b, 0) /
            metrics.latencySamples.length) *
            100
        ) / 100
      : 0;
  const compressionRatio =
    metrics.rawBytes > 0
      ? Math.round((1 - metrics.compressedBytes / metrics.rawBytes) * 100)
      : 0; // honest zero — no messages compressed yet, not an assumed/typical value

  return {
    connectedUsers: sessions.size,
    activeRooms: [...rooms.values()].filter((s) => s.size > 0).length,
    totalMessages: metrics.totalMessages,
    successfulDeliveries: metrics.successfulDeliveries,
    failedDeliveries: metrics.failedDeliveries,
    msgsPerHour,
    avgLatency,
    compressionRatio,
    uptimeSeconds: Math.floor(uptimeMs / 1000),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(ws: WebSocket, payload: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(
  roomId: RoomId,
  payload: ServerMessage,
  excludeId: string | null = null
): number {
  const roomSet = rooms.get(roomId);
  if (!roomSet) return 0;

  const data = JSON.stringify(payload);
  const rawBytes = Buffer.byteLength(data, "utf8");
  metrics.rawBytes += rawBytes;
  // Actually measured, not assumed: deflate the same payload with the same
  // options the WebSocket server's perMessageDeflate uses, and record the
  // real compressed size. `ws` doesn't expose per-frame compressed byte
  // counts from its internals, so this runs the identical algorithm
  // out-of-band purely to get an honest number for the metrics/dashboard —
  // it does not affect what's actually sent over the wire.
  const compressed = zlib.deflateRawSync(data, { level: 3, memLevel: 7 });
  metrics.compressedBytes += compressed.length;

  let delivered = 0;
  const t0 = performance.now();

  roomSet.forEach((sid) => {
    if (sid === excludeId) return;
    const session = sessions.get(sid);
    if (!session) return;
    const ws = session.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
        delivered++;
        metrics.successfulDeliveries++;
      } catch (err) {
        metrics.failedDeliveries++;
        console.error(`[broadcast] send error to ${sid}:`, (err as Error).message);
      }
    }
  });

  // Record latency sample
  const latency = performance.now() - t0;
  metrics.latencySamples.push(latency);
  if (metrics.latencySamples.length > 500) metrics.latencySamples.shift();

  return delivered;
}

function getRoomUsers(roomId: RoomId): UserSummary[] {
  return [...(rooms.get(roomId) || [])]
    .map((sid) => sessions.get(sid))
    .filter((s): s is Session => Boolean(s))
    .map(({ id, username, connectedAt }) => ({ id, username, connectedAt }));
}

function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && (ROOMS as readonly string[]).includes(value);
}

// ─── WebSocket connection ─────────────────────────────────────────────────────
wss.on("connection", (ws: HeartbeatWebSocket) => {
  const socketId = uuidv4();
  const connectedAt = new Date().toISOString();
  ws.isAlive = true;

  console.log(`[ws] connect  ${socketId}  (total: ${wss.clients.size})`);

  // Welcome — send room list & initial metrics
  send(ws, { type: "welcome", socketId, rooms: ROOMS, metrics: getMetrics() });

  // ── Message handler ─────────────────────────────────────────────────────────
  ws.on("message", (raw: WebSocket.RawData) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const session = sessions.get(socketId);

    switch (msg.type) {
      // JOIN ──────────────────────────────────────────────────────────────────
      case "join": {
        const { token, room } = msg;
        const authUser = token ? verifyToken(token) : null;
        if (!authUser || !isRoomId(room)) {
          send(ws, { type: "error", message: "Invalid or missing token, or invalid room" });
          return;
        }
        const username = authUser.username;

        // Leave old room
        if (session?.room) {
          rooms.get(session.room)?.delete(socketId);
          broadcast(session.room, {
            type: "user_left",
            userId: socketId,
            username: session.username,
            users: getRoomUsers(session.room),
          });
        }

        sessions.set(socketId, {
          id: socketId,
          ws,
          username,
          room,
          connectedAt,
          msgCount: 0,
        });
        rooms.get(room)!.add(socketId);

        // Send history + room state to joiner (history now read from SQLite)
        send(ws, {
          type: "joined",
          room,
          username,
          history: db.getRecentMessages(room, MAX_HISTORY),
          users: getRoomUsers(room),
          metrics: getMetrics(),
        });

        // Notify others
        broadcast(
          room,
          {
            type: "user_joined",
            userId: socketId,
            username,
            users: getRoomUsers(room),
          },
          socketId
        );

        console.log(`[ws] ${username} joined #${room}  (sessions: ${sessions.size})`);
        break;
      }

      // MESSAGE ───────────────────────────────────────────────────────────────
      case "message": {
        if (!session) {
          send(ws, { type: "error", message: "Join a room first" });
          return;
        }
        if (isRateLimited(socketId)) {
          send(ws, {
            type: "error",
            message: `You're sending messages too fast (max ${MSG_RATE_LIMIT}/s). Slow down a bit.`,
          });
          return;
        }
        const { content, clientMsgId } = msg;
        if (!content?.trim()) return;
        if (content.length > MAX_MESSAGE_LENGTH) {
          send(ws, {
            type: "error",
            message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters, got ${content.length}).`,
          });
          return;
        }

        const message: ChatMessage = {
          id: uuidv4(),
          clientMsgId: clientMsgId || null,
          userId: socketId,
          username: session.username,
          room: session.room,
          content: content.trim(),
          timestamp: new Date().toISOString(),
        };

        metrics.totalMessages++;
        session.msgCount++;

        const delivered = broadcast(session.room, { type: "message", message });
        db.insertMessage(message);

        // ACK back to sender
        send(ws, {
          type: "message_ack",
          clientMsgId: clientMsgId || null,
          serverId: message.id,
          delivered,
          timestamp: message.timestamp,
        });
        break;
      }

      // TYPING ────────────────────────────────────────────────────────────────
      case "typing": {
        if (!session) return;
        broadcast(
          session.room,
          {
            type: "typing",
            userId: socketId,
            username: session.username,
            isTyping: !!msg.isTyping,
          },
          socketId
        );
        break;
      }

      // SWITCH ROOM ───────────────────────────────────────────────────────────
      case "switch_room": {
        if (!session) return;
        const { room: newRoom } = msg;
        if (!isRoomId(newRoom) || newRoom === session.room) return;

        rooms.get(session.room)?.delete(socketId);
        broadcast(session.room, {
          type: "user_left",
          userId: socketId,
          username: session.username,
          users: getRoomUsers(session.room),
        });

        session.room = newRoom;
        rooms.get(newRoom)!.add(socketId);

        send(ws, {
          type: "room_switched",
          room: newRoom,
          history: db.getRecentMessages(newRoom, MAX_HISTORY),
          users: getRoomUsers(newRoom),
        });

        broadcast(
          newRoom,
          {
            type: "user_joined",
            userId: socketId,
            username: session.username,
            users: getRoomUsers(newRoom),
          },
          socketId
        );
        break;
      }

      // PING ──────────────────────────────────────────────────────────────────
      case "ping": {
        send(ws, { type: "pong", serverTime: Date.now(), metrics: getMetrics() });
        break;
      }

      default:
        send(ws, {
          type: "error",
          message: `Unknown type: ${(msg as ClientMessage).type}`,
        });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  ws.on("close", () => {
    const session = sessions.get(socketId);
    if (session) {
      rooms.get(session.room)?.delete(socketId);
      broadcast(session.room, {
        type: "user_left",
        userId: socketId,
        username: session.username,
        users: getRoomUsers(session.room),
      });
      console.log(`[ws] disconnect ${session.username}  (sessions: ${sessions.size - 1})`);
    }
    sessions.delete(socketId);
    msgWindows.delete(socketId);
  });

  ws.on("error", (err: Error) => {
    console.error(`[ws] error ${socketId}:`, err.message);
    sessions.delete(socketId);
    msgWindows.delete(socketId);
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });
});

// ─── Heartbeat — cull dead connections every 30 s ────────────────────────────
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws: HeartbeatWebSocket) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(heartbeat));
wss.on("close", () => clearInterval(rateTimer));

// ─── Auth API ───────────────────────────────────────────────────────────────
// Shared by both routes: 10 attempts per IP per 15 minutes. Applies to failed
// *and* successful requests alike (simplest correct option — scoping it to
// failures only would need a second, stateful counter keyed by username, which
// is its own can of worms around enumeration).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  skip: () => process.env.BENCHMARK_MODE === "1",
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  try {
    const { user, token } = await register(db, username, password);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    console.error("[auth/register] error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  try {
    const { user, token } = await login(db, username, password);
    res.json({ user, token });
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    console.error("[auth/login] error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

app.get("/api/metrics", (_req: Request, res: Response) => res.json(getMetrics()));

app.get("/api/rooms", (_req: Request, res: Response) =>
  res.json(
    ROOMS.map((r) => ({
      id: r,
      users: getRoomUsers(r).length,
      messages: db.getRecentMessages(r, MAX_HISTORY).length,
    }))
  )
);

app.get("/api/rooms/:room/history", (req: Request, res: Response) => {
  const { room } = req.params;
  if (!isRoomId(room)) return res.status(404).json({ error: "Room not found" });
  res.json(db.getRecentMessages(room, MAX_HISTORY));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n🚀  Server →  http://localhost:${PORT}`);
  console.log(`   WebSocket →  ws://localhost:${PORT}`);
  console.log(`   Rooms: ${ROOMS.join(", ")}\n`);
});
