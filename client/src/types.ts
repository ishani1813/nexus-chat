export type RoomId = "general" | "engineering" | "random" | "design";

export type ConnState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type DeliveryStatus = "sending" | "sent" | "delivered" | "failed";

export interface ChatMessage {
  id: string;
  clientMsgId?: string | null;
  userId: string;
  username: string;
  room: RoomId;
  content: string;
  timestamp: string;
  type?: "system";
  isMine?: boolean;
  deliveryStatus?: DeliveryStatus;
}

export interface UserSummary {
  id: string;
  username: string;
  connectedAt: string;
}

export interface TypingUser {
  userId: string;
  username: string;
}

export interface Metrics {
  connectedUsers: number;
  activeRooms: number;
  totalMessages: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  msgsPerHour: number;
  avgLatency: number;
  compressionRatio: number;
  uptimeSeconds: number;
}

// ── Messages the server sends to the client ──────────────────────────────────
export type ServerMessage =
  | { type: "welcome"; socketId: string; rooms: RoomId[]; metrics: Metrics }
  | {
      type: "joined";
      room: RoomId;
      username: string;
      history: ChatMessage[];
      users: UserSummary[];
      metrics: Metrics;
    }
  | { type: "message"; message: ChatMessage }
  | {
      type: "message_ack";
      clientMsgId: string | null;
      serverId: string;
      delivered: number;
      timestamp: string;
    }
  | { type: "typing"; userId: string; username: string; isTyping: boolean }
  | { type: "room_switched"; room: RoomId; history: ChatMessage[]; users: UserSummary[] }
  | { type: "user_joined"; userId: string; username: string; users: UserSummary[] }
  | { type: "user_left"; userId: string; username: string; users: UserSummary[] }
  | { type: "pong"; serverTime: number; metrics: Metrics }
  | { type: "error"; message: string };

// ── Messages the client sends to the server ───────────────────────────────────
export type ClientMessage =
  | { type: "join"; username: string; room: RoomId }
  | { type: "message"; content: string; clientMsgId: string }
  | { type: "typing"; isTyping: boolean }
  | { type: "switch_room"; room: RoomId }
  | { type: "ping" };
