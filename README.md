# ⚡ NexusChat — Real-Time Chat Application

![CI](https://github.com/ishani1813/nexus-chat/actions/workflows/ci.yml/badge.svg)

> **Stack:** React 18 · TypeScript · Node.js · Express · WebSocket (`ws`) · Vite

A real-time chat app with room-based messaging, delivery receipts, typing indicators, and a live metrics dashboard — built to explore WebSocket connection handling, message delivery guarantees, and payload compression at scale.

---

## Features

- 4 chat rooms — general, engineering, random, design
- Message history (last 100 per room) delivered on join
- Real-time typing indicators with 3s auto-clear
- Delivery receipts per message (sending → sent → delivered)
- Message grouping — consecutive messages within 60s are grouped
- System events — join/leave shown inline
- Exponential backoff reconnection (up to 6 retries)
- Live metrics dashboard — connected users, latency, messages/hour, compression ratio
- Fully responsive — mobile hamburger menu + slide-over sidebar

---

## Architecture

```
nexus-chat/
├── package.json                        ← root runner (concurrently)
│
├── server/
│   ├── package.json
│   ├── loadtest.mjs                    ← WS load-testing script (see Performance below)
│   └── src/
│       ├── server.ts                   ← Express + WebSocket server
│       └── types.ts
│
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx                     ← root state + WS orchestration
        ├── index.css
        ├── hooks/
        │   └── useWebSocket.ts         ← connection, reconnect, ACK, ping/pong RTT
        ├── components/
        │   ├── Avatar.tsx
        │   ├── MessageBubble.tsx       ← grouping, delivery status, system msgs
        │   ├── Sidebar.tsx             ← rooms, users, live metrics panel
        │   ├── ChatWindow.tsx          ← messages list, typing indicator, input
        │   ├── JoinScreen.tsx          ← username + room picker
        │   └── MetricsDashboard.tsx    ← live charts: latency, throughput, compression
        └── utils/
            └── helpers.ts              ← formatters, avatar, grouping
```

**Key implementation details:**
- **Compression** — `perMessageDeflate` enabled on the WebSocket server (`server/src/server.ts`), with a 128-byte threshold so small control messages aren't wasted on compression overhead.
- **Session management** — `Map<socketId, Session>` and `Map<roomId, Set<socketId>>` for O(1) session lookup and O(n) room fan-out, with a 30s heartbeat to cull dead connections.
- **Delivery guarantees** — every client message gets a server-side ACK (`message_ack`) with a delivered-recipient count; the client shows optimistic "sending" state until the ACK lands.
- **Reconnection** — `useWebSocket.ts` implements exponential backoff (up to 6 retries) with promise-based ACK timeouts (5s) and ping/pong RTT tracking.

---

## Performance

Rather than quote unverified numbers, this repo ships the load-testing script used to measure them: [`server/loadtest.mjs`](server/loadtest.mjs). Run it yourself against a local instance:

```bash
cd server && node loadtest.mjs 200 20   # 200 concurrent clients, 20s duration
```

**Most recent local run (200 concurrent clients, single machine, loopback network — not a distributed/production benchmark):**

| Metric | Result |
|---|---|
| Peak concurrent connections | 200 / 200, 0 connection errors |
| Join ACK latency | avg 45ms · p50 49ms · p95 95ms |
| Message round-trip (send → ack) | avg 16ms · p50 8ms · p95 33ms |
| Message delivery rate | 1,513 / 1,513 acked (100%) |
| Extrapolated throughput | ~257,000 unique messages/hour at this concurrency |

Note: the server's own `/api/metrics` endpoint reports a much higher `msgsPerHour` figure — that number counts each *fanned-out delivery* (one message to N room members = N deliveries), not unique messages sent. Worth knowing before quoting either number out of context.

This is a loopback test on a single container, so treat it as a reproducible lower bound on what the connection-handling and broadcast logic can do, not a production capacity claim — real network latency and multi-core scaling aren't exercised here.

---

## How to Run

### Prerequisites
- Node.js 18+

### 1. Install dependencies

```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Start both server and client

```bash
npm run dev
```

- **Frontend →** http://localhost:5173
- **Backend  →** http://localhost:4000
- **WebSocket →** ws://localhost:4000

Or run separately in two terminals:

```bash
# Terminal 1
npm run dev:server

# Terminal 2
npm run dev:client
```

---

## REST API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/health` | Server health check |
| `GET /api/metrics` | Live performance metrics |
| `GET /api/rooms` | All rooms with user counts |
| `GET /api/rooms/:room/history` | Last 100 messages in a room |

---

## WebSocket Message Protocol

| Type | Direction | Description |
|---|---|---|
| `welcome` | S→C | Handshake — sends socketId + rooms |
| `join` | C→S | Enter a room with username |
| `joined` | S→C | ACK — sends history + users + metrics |
| `message` | C→S | Send a chat message |
| `message` | S→C | Broadcast to room |
| `message_ack` | S→C | Delivery confirmation + recipient count |
| `typing` | C↔S | Typing indicator (broadcast) |
| `switch_room` | C→S | Move to a different room |
| `room_switched` | S→C | Switch ACK — sends new history + users |
| `user_joined` | S→C | Broadcast when someone joins |
| `user_left` | S→C | Broadcast when someone disconnects |
| `ping` / `pong` | C↔S | Heartbeat + metrics refresh (RTT) |

---

## Known limitations

- In-memory state only — restarting the server drops all sessions, rooms, and history (no persistence layer yet).
- Single-process — no horizontal scaling (would need a shared pub/sub layer like Redis to run multiple server instances behind a load balancer).
- No authentication — usernames are self-declared on join, not verified.
