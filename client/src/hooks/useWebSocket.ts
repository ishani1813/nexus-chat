import { useEffect, useRef, useCallback, useState } from "react";
import type { ConnState, Metrics, ServerMessage } from "../types";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 1000;
const ACK_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15000;

interface UseWebSocketArgs {
  onMessage: (msg: ServerMessage) => void;
  onMetrics: (metrics: Metrics) => void;
}

interface PendingAck {
  resolve: (ack: Extract<ServerMessage, { type: "message_ack" }> | null) => void;
  ts: number;
}

export function useWebSocket({ onMessage, onMetrics }: UseWebSocketArgs) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingAcks = useRef(new Map<string, PendingAck>());
  const onMessageRef = useRef(onMessage);
  const onMetricsRef = useRef(onMetrics);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  const [state, setState] = useState<ConnState>("disconnected");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);

  // ── Ping loop ────────────────────────────────────────────────────────────────
  const startPing = useCallback((ws: WebSocket) => {
    clearInterval(pingTimer.current);
    pingTimer.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const t0 = Date.now();
      ws.send(JSON.stringify({ type: "ping" }));

      const handler = (ev: MessageEvent) => {
        try {
          const msg: ServerMessage = JSON.parse(ev.data);
          if (msg.type !== "pong") return;
          setRtt(Date.now() - t0);
          onMetricsRef.current?.(msg.metrics);
          ws.removeEventListener("message", handler);
        } catch {
          /* ignore */
        }
      };
      ws.addEventListener("message", handler);
    }, PING_INTERVAL_MS);
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    setState(retriesRef.current > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      setState("connected");
      startPing(ws);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      // Welcome: capture socketId
      if (msg.type === "welcome") {
        setSocketId(msg.socketId);
        onMetricsRef.current?.(msg.metrics);
      }

      // ACK: resolve pending promise
      if (msg.type === "message_ack") {
        const p = pendingAcks.current.get(msg.clientMsgId ?? "");
        if (p) {
          setRtt(Date.now() - p.ts);
          p.resolve(msg);
          pendingAcks.current.delete(msg.clientMsgId ?? "");
        }
      }

      if (msg.type === "pong") return; // handled in ping loop

      onMessageRef.current?.(msg);
    };

    ws.onclose = (ev: CloseEvent) => {
      clearInterval(pingTimer.current);
      setState("disconnected");
      if (!ev.wasClean && retriesRef.current < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, retriesRef.current);
        retriesRef.current++;
        console.log(`[ws] retry #${retriesRef.current} in ${delay}ms`);
        retryTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (err: Event) => console.error("[ws] error:", err);
  }, [startPing]);

  useEffect(() => {
    connect();
    return () => {
      clearInterval(pingTimer.current);
      clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Public send helpers ───────────────────────────────────────────────────────
  const rawSend = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  /**
   * sendMessage — optimistic send with ACK promise.
   * Resolves with ACK payload or null on timeout.
   */
  const sendMessage = useCallback(
    (content: string, clientMsgId: string) => {
      return new Promise<Extract<ServerMessage, { type: "message_ack" }> | null>((resolve) => {
        pendingAcks.current.set(clientMsgId, { resolve, ts: Date.now() });
        const ok = rawSend({ type: "message", content, clientMsgId });
        if (!ok) {
          pendingAcks.current.delete(clientMsgId);
          resolve(null);
          return;
        }
        setTimeout(() => {
          if (pendingAcks.current.has(clientMsgId)) {
            pendingAcks.current.delete(clientMsgId);
            resolve(null);
          }
        }, ACK_TIMEOUT_MS);
      });
    },
    [rawSend]
  );

  const join = useCallback(
    (token: string, room: string) => rawSend({ type: "join", token, room }),
    [rawSend]
  );
  const switchRoom = useCallback(
    (room: string) => rawSend({ type: "switch_room", room }),
    [rawSend]
  );
  const sendTyping = useCallback(
    (isTyping: boolean) => rawSend({ type: "typing", isTyping }),
    [rawSend]
  );

  return { state, socketId, rtt, sendMessage, join, switchRoom, sendTyping };
}
