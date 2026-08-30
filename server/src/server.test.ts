import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { ROOMS, type RoomId, type ChatMessage, type Session } from "./types";

// This test file stands up the same server logic as src/server.ts on an
// ephemeral port, so tests run against real WebSocket connections rather
// than mocks. It intentionally mirrors server.ts's core handlers rather
// than importing them directly, since server.ts starts listening as a
// side effect of being imported (no exported app/server to reuse safely
// in a test process without also binding the real port).

let server: http.Server;
let port: number;
const sessions = new Map<string, Session>();
const rooms = new Map<RoomId, Set<string>>();
const messageHistory = new Map<RoomId, ChatMessage[]>();
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
  ROOMS.forEach((r) => {
    rooms.set(r, new Set());
    messageHistory.set(r, []);
  });

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
        if (!msg.username?.trim() || !isRoomId(msg.room)) {
          send(ws, { type: "error", message: "Invalid username or room" });
          return;
        }
        if (session?.room) rooms.get(session.room)?.delete(socketId);
        sessions.set(socketId, {
          id: socketId,
          ws,
          username: msg.username.trim(),
          room: msg.room,
          connectedAt: new Date().toISOString(),
          msgCount: 0,
        });
        rooms.get(msg.room)!.add(socketId);
        send(ws, {
          type: "joined",
          room: msg.room,
          history: messageHistory.get(msg.room) || [],
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
        const hist = messageHistory.get(session.room) || [];
        hist.push(message);
        if (hist.length > MAX_HISTORY) hist.shift();
        messageHistory.set(session.room, hist);
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
});

beforeEach(() => {
  sessions.clear();
  rooms.forEach((s) => s.clear());
  messageHistory.forEach((_, k) => messageHistory.set(k, []));
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

describe("join flow", () => {
  it("sends a joined ack with room history on successful join", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", username: "alice", room: "general" }));
    const joined = await waitFor(ws, (m) => m.type === "joined");
    expect(joined.room).toBe("general");
    expect(joined.history).toEqual([]);
    ws.close();
  });

  it("rejects a join with an invalid room", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", username: "alice", room: "not-a-real-room" }));
    const err = await waitFor(ws, (m) => m.type === "error");
    expect(err.message).toMatch(/invalid/i);
    ws.close();
  });

  it("rejects a join with an empty username", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", username: "   ", room: "general" }));
    const err = await waitFor(ws, (m) => m.type === "error");
    expect(err.message).toMatch(/invalid/i);
    ws.close();
  });
});

describe("message delivery", () => {
  it("acks the sender and broadcasts to other room members", async () => {
    const alice = await connect();
    const bob = await connect();

    alice.send(JSON.stringify({ type: "join", username: "alice", room: "general" }));
    await waitFor(alice, (m) => m.type === "joined");
    bob.send(JSON.stringify({ type: "join", username: "bob", room: "general" }));
    await waitFor(bob, (m) => m.type === "joined");

    const bobReceived = waitFor(bob, (m) => m.type === "message");
    alice.send(JSON.stringify({ type: "message", content: "hello bob", clientMsgId: "abc123" }));

    const ack = await waitFor(alice, (m) => m.type === "message_ack");
    expect(ack.clientMsgId).toBe("abc123");
    // broadcast() delivers to every connected room member, sender included
    // (the server does not exclude the sender for chat messages — only
    // for join/leave notifications). alice + bob are both in the room.
    expect(ack.delivered).toBe(2);

    const received = await bobReceived;
    expect(received.message.content).toBe("hello bob");
    expect(received.message.username).toBe("alice");

    alice.close();
    bob.close();
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
    const alice = await connect();
    const carol = await connect();

    alice.send(JSON.stringify({ type: "join", username: "alice", room: "general" }));
    await waitFor(alice, (m) => m.type === "joined");
    carol.send(JSON.stringify({ type: "join", username: "carol", room: "random" }));
    await waitFor(carol, (m) => m.type === "joined");

    let carolGotMessage = false;
    carol.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "message") carolGotMessage = true;
    });

    alice.send(JSON.stringify({ type: "message", content: "only for #general" }));
    await waitFor(alice, (m) => m.type === "message_ack");

    // give any wrongly-delivered broadcast a moment to arrive
    await new Promise((r) => setTimeout(r, 200));
    expect(carolGotMessage).toBe(false);

    alice.close();
    carol.close();
  });
});

describe("reconnect / history", () => {
  it("replays room history to a client joining after messages were sent", async () => {
    const alice = await connect();
    alice.send(JSON.stringify({ type: "join", username: "alice", room: "engineering" }));
    await waitFor(alice, (m) => m.type === "joined");
    alice.send(JSON.stringify({ type: "message", content: "first message" }));
    await waitFor(alice, (m) => m.type === "message_ack");
    alice.close();

    const dave = await connect();
    dave.send(JSON.stringify({ type: "join", username: "dave", room: "engineering" }));
    const joined = await waitFor(dave, (m) => m.type === "joined");

    expect(joined.history).toHaveLength(1);
    expect(joined.history[0].content).toBe("first message");
    dave.close();
  });
});
