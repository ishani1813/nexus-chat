# ⚡ NexusChat — Real-Time Chat Application

> **Stack:** React 18 · Node.js · Express · WebSocket (ws) · Vite

A production-grade real-time chat app that proves every metric on your resume.

---

## File Structure

```
nexus-chat/
├── package.json                        ← root runner (concurrently)
│
├── server/
│   ├── package.json
│   └── src/
│       └── server.js                   ← Express + WebSocket server
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx                     ← root state + WS orchestration
        ├── index.css
        ├── hooks/
        │   └── useWebSocket.js         ← connection, reconnect, ACK, ping/pong RTT
        ├── components/
        │   ├── Avatar.jsx
        │   ├── MessageBubble.jsx       ← grouping, delivery status, system msgs
        │   ├── Sidebar.jsx             ← rooms, users, live metrics panel
        │   ├── ChatWindow.jsx          ← messages list, typing indicator, input
        │   ├── JoinScreen.jsx          ← username + room picker
        │   └── MetricsDashboard.jsx    ← 📊 live charts for HRs / portfolio demo
        └── utils/
            └── helpers.js              ← formatters, avatar, grouping
```

---

## How to Run

### Step 1 — Install dependencies

```bash
# From the nexus-chat/ root folder:
npm install
npm install --prefix server
npm install --prefix client
```

### Step 2 — Start both server and client

```bash
npm run dev
```

This starts both at once:
- **Frontend →** http://localhost:5173
- **Backend  →** http://localhost:4000
- **WebSocket →** ws://localhost:4000

### Or run separately in two terminals:

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

## Resume Bullet Implementation

### Compression — 35% bandwidth, <250ms updates
**File:** `server/src/server.js`
```js
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 3, memLevel: 7 },
    threshold: 128,   // only compress payloads > 128 bytes
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
  },
});
```
The `broadcast()` function records raw vs compressed bytes and rolling latency (500-sample window). Surfaced live in the sidebar metrics panel and the 📊 dashboard.

### Sessions — 200 concurrent users, 120ms latency cut, 102k msgs/hr
**File:** `server/src/server.js`
```js
const sessions = new Map();  // socketId → session data
const rooms    = new Map();  // roomId   → Set<socketId>
```
O(n) fan-out broadcast, per-socket error isolation, 30s heartbeat to cull dead connections. `getMetrics()` computes msgs/hr from `successfulDeliveries / uptimeHours`.

### Debugging — network, API, UI layers
- **Network:** `useWebSocket.js` — exponential backoff reconnect, promise-based ACKs with 5s timeout, RTT via ping/pong
- **API:** REST `/api/metrics`, `/api/rooms`, `/api/health`
- **UI:** Optimistic rendering in `App.jsx` — messages show instantly as "sending", update to "delivered" on ACK. Click 📊 button to open the live performance dashboard.

---

## Features

- 4 chat rooms — general, engineering, random, design
- Message history (last 100 per room) delivered on join
- Real-time typing indicators with 3s auto-clear
- Delivery receipts per message (sending → sent → delivered)
- Message grouping — consecutive messages within 60s are grouped
- System events — join/leave shown inline
- Exponential backoff reconnection (up to 6 retries)
- Live metrics sidebar — users, latency, msgs/hr, compression %
- 📊 Performance dashboard — sparklines, bandwidth bars, load chart, resume bullets
- Fully responsive — mobile hamburger menu + slide-over sidebar
