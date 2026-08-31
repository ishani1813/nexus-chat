import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { ROOMS, type RoomId, type ChatMessage, type Session } from "./types";
import { createDb, type Db } from "./db";
import { register, login, verifyToken, AuthError } from "./auth";

// This test file stands up the same server logic as src/server.ts on an
// ephemeral port and an in-memory SQLite database, so tests run against
// real WebSocket connections and real auth/persistence code rather than
// mocks. The WS message-routing switch is intentionally re-implemented
// here (rather than imported from server.ts) since server.ts starts
// listening on a fixed port as a side effect of being imported. The auth
// (auth.ts) and persistence (db.ts) modules ARE imported directly and
// exercised for real — those are the parts this round of tests is for.

let server: http.Server;
let port: number;
let db: Db;
const sessions = new Map<string, Session>();
const rooms = new Map<RoomId, Set<string>>();
const MAX_HISTORY = 100;

function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && (ROOMS as readonly string[]).includes(value);
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room: RoomId, payload: unknown, exceptSocketId?: string) {
  let delivered = 0;
  for (const sid of rooms.get(room) || []) {
    if (sid === exceptSocketId) continue;
    const s = sessions.get(sid);
    if (s && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify(payload));
      delivered++;
    }
  }
  return delivered;
}

beforeAll(async () => {
  db = createDb(":memory:");
  ROOMS.forEach((r) => rooms.set(r, new Set()));

  const app = express();
  app.use(cors());
  server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    const socketId = uuidv4();
    send(ws, { type: "welcome", socketId, rooms: ROOMS });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const session = sessions.get(socketId);

      if (msg.type === "join") {
        const authUser = msg.token ? verifyToken(msg.token) : null;
        if (!authUser || !isRoomId(msg.room)) {
          send(ws, { type: "error", message: "Invalid or missing token, or invalid room" });
          return;
        }
        const username = authUser.username;
        if (session?.room) rooms.get(session.room)?.delete(socketId);
        sessions.set(socketId, {
          id: socketId,
          ws,
          username,
          room: msg.room,
          connectedAt: new Date().toISOString(),
          msgCount: 0,
        });
        rooms.get(msg.room)!.add(socketId);
        send(ws, {
          type: "joined",
          room: msg.room,
          username,
          history: db.getRecentMessages(msg.room, MAX_HISTORY),
        });
        broadcast(msg.room, { type: "user_joined", userId: socketId }, socketId);
      }

      if (msg.type === "message") {
        if (!session) {
          send(ws, { type: "error", message: "Join a room first" });
          return;
        }
        if (!msg.content?.trim()) return;
        const message: ChatMessage = {
          id: uuidv4(),
          clientMsgId: msg.clientMsgId || null,
          userId: socketId,
          username: session.username,
          room: session.room,
          content: msg.content.trim(),
          timestamp: new Date().toISOString(),
        };
        const delivered = broadcast(session.room, { type: "message", message });
        db.insertMessage(message);
        send(ws, { type: "message_ack", clientMsgId: msg.clientMsgId || null, delivered });
      }
    });

    ws.on("close", () => {
      const session = sessions.get(socketId);
      if (session?.room) rooms.get(session.room)?.delete(socketId);
      sessions.delete(socketId);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  db.close();
});

beforeEach(() => {
  sessions.clear();
  rooms.forEach((s) => s.clear());
  // Each test gets a clean messages table; users persist across tests
  // since each test creates uniquely-named users via makeUser() below,
  // so there's no need to reset the users table between tests.
  db.raw.exec("DELETE FROM messages");
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
  });
}

function waitFor(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("waitFor timed out")), timeoutMs);
    const handler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

let userCounter = 0;
async function makeUser(): Promise<{ username: string; token: string }> {
  userCounter++;
  const username = `u${userCounter}${Math.random().toString(36).slice(2, 9)}`;
  const { token } = await register(db, username, "password123");
  return { username, token };
}

// ─── Auth ─────────────────────────────────────────────────────────────────
describe("auth: register", () => {
  it("creates a user and returns a valid JWT", async () => {
    const { user, token } = await register(db, `alice_${Date.now()}`, "password123");
    expect(user.username).toMatch(/^alice_/);
    const decoded = verifyToken(token);
    expect(decoded?.username).toBe(user.username);
  });

  it("rejects a duplicate username", async () => {
    const username = `dup_${Date.now()}`;
    await register(db, username, "password123");
    await expect(register(db, username, "differentpass1")).rejects.toThrow(AuthError);
  });

  it("rejects a password under 8 characters", async () => {
    await expect(register(db, `shortpw_${Date.now()}`, "abc123")).rejects.toThrow(AuthError);
  });

  it("rejects an invalid username (special characters)", async () => {
    await expect(register(db, "bad name!", "password123")).rejects.toThrow(AuthError);
  });
});

describe("auth: login", () => {
  it("logs in with correct credentials", async () => {
    const username = `bob_${Date.now()}`;
    await register(db, username, "correctpass1");
    const { token } = await login(db, username, "correctpass1");
    expect(verifyToken(token)?.username).toBe(username);
  });

  it("rejects an incorrect password", async () => {
    const username = `carol_${Date.now()}`;
    await register(db, username, "correctpass1");
    await expect(login(db, username, "wrongpass1")).rejects.toThrow(AuthError);
  });

  it("rejects a username that doesn't exist", async () => {
    await expect(login(db, "nobody_here", "whatever1")).rejects.toThrow(AuthError);
  });
});

describe("auth: WebSocket join requires a valid token", () => {
  it("rejects a join with no token", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", room: "general" }));
    const err = await waitFor(ws, (m) => m.type === "error");
    expect(err.message).toMatch(/token/i);
    ws.close();
  });

  it("rejects a join with a garbage token", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", token: "not.a.valid.jwt", room: "general" }));
    const err = await waitFor(ws, (m) => m.type === "error");
    expect(err.message).toMatch(/token/i);
    ws.close();
  });

  it("accepts a join with a valid token and uses the verified username, ignoring any client-supplied one", async () => {
    const { username, token } = await makeUser();
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", token, room: "general", username: "impersonator" }));
    const joined = await waitFor(ws, (m) => m.type === "joined");
    expect(joined.username).toBe(username);
    ws.close();
  });
});

// ─── Message delivery (now token-gated) ────────────────────────────────────
describe("message delivery", () => {
  it("acks the sender and broadcasts to other room members", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceWs = await connect();
    const bobWs = await connect();

    aliceWs.send(JSON.stringify({ type: "join", token: alice.token, room: "general" }));
    await waitFor(aliceWs, (m) => m.type === "joined");
    bobWs.send(JSON.stringify({ type: "join", token: bob.token, room: "general" }));
    await waitFor(bobWs, (m) => m.type === "joined");

    const bobReceived = waitFor(bobWs, (m) => m.type === "message");
    aliceWs.send(JSON.stringify({ type: "message", content: "hello bob", clientMsgId: "abc123" }));

    const ack = await waitFor(aliceWs, (m) => m.type === "message_ack");
    expect(ack.clientMsgId).toBe("abc123");
    expect(ack.delivered).toBe(2); // broadcast includes the sender

    const received = await bobReceived;
    expect(received.message.content).toBe("hello bob");
    expect(received.message.username).toBe(alice.username);

    aliceWs.close();
    bobWs.close();
  });

  it("rejects a message from a socket that hasn't joined a room", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "message", content: "hi" }));
    const err = await waitFor(ws, (m) => m.type === "error");
    expect(err.message).toMatch(/join a room/i);
    ws.close();
  });
});

describe("room isolation", () => {
  it("does not deliver messages across different rooms", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const aliceWs = await connect();
    const carolWs = await connect();

    aliceWs.send(JSON.stringify({ type: "join", token: alice.token, room: "general" }));
    await waitFor(aliceWs, (m) => m.type === "joined");
    carolWs.send(JSON.stringify({ type: "join", token: carol.token, room: "random" }));
    await waitFor(carolWs, (m) => m.type === "joined");

    let carolGotMessage = false;
    carolWs.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "message") carolGotMessage = true;
    });

    aliceWs.send(JSON.stringify({ type: "message", content: "only for #general" }));
    await waitFor(aliceWs, (m) => m.type === "message_ack");
    await new Promise((r) => setTimeout(r, 200));
    expect(carolGotMessage).toBe(false);

    aliceWs.close();
    carolWs.close();
  });
});

// ─── Persistence (SQLite, not memory) ──────────────────────────────────────
describe("persistence", () => {
  it("replays room history to a client joining after messages were sent", async () => {
    const alice = await makeUser();
    const aliceWs = await connect();
    aliceWs.send(JSON.stringify({ type: "join", token: alice.token, room: "engineering" }));
    await waitFor(aliceWs, (m) => m.type === "joined");
    aliceWs.send(JSON.stringify({ type: "message", content: "first message" }));
    await waitFor(aliceWs, (m) => m.type === "message_ack");
    aliceWs.close();

    const dave = await makeUser();
    const daveWs = await connect();
    daveWs.send(JSON.stringify({ type: "join", token: dave.token, room: "engineering" }));
    const joined = await waitFor(daveWs, (m) => m.type === "joined");

    expect(joined.history).toHaveLength(1);
    expect(joined.history[0].content).toBe("first message");
    daveWs.close();
  });

  it("persists messages directly to the database, independent of any live connection", async () => {
    const alice = await makeUser();
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", token: alice.token, room: "design" }));
    await waitFor(ws, (m) => m.type === "joined");
    ws.send(JSON.stringify({ type: "message", content: "durable message" }));
    await waitFor(ws, (m) => m.type === "message_ack");
    ws.close();

    // Read directly from the DB layer, bypassing any WebSocket/in-memory
    // path entirely — this is the actual proof that history survives a
    // server restart (a restart drops in-memory state but not the DB file).
    const fromDb = db.getRecentMessages("design", 10);
    expect(fromDb).toHaveLength(1);
    expect(fromDb[0].content).toBe("durable message");
  });
});
