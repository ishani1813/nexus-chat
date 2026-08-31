import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { RoomId, ChatMessage } from "./types";

const DB_PATH = process.env.NEXUS_DB_PATH || path.join(__dirname, "..", "data", "nexus-chat.db");

export function createDb(dbPath: string = DB_PATH) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      client_msg_id TEXT,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      room TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp
      ON messages (room, timestamp);
  `);

  return {
    raw: db,

    // ── Users ──────────────────────────────────────────────────────────────
    createUser(user: { id: string; username: string; passwordHash: string }) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`
      ).run(user.id, user.username, user.passwordHash, new Date().toISOString());
    },

    findUserByUsername(username: string): { id: string; username: string; password_hash: string } | undefined {
      return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as any;
    },

    // ── Messages ───────────────────────────────────────────────────────────
    insertMessage(message: ChatMessage) {
      db.prepare(
        `INSERT INTO messages (id, client_msg_id, user_id, username, room, content, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        message.id,
        message.clientMsgId,
        message.userId,
        message.username,
        message.room,
        message.content,
        message.timestamp
      );
    },

    getRecentMessages(room: RoomId, limit = 100): ChatMessage[] {
      const rows = db
        .prepare(
          `SELECT id, client_msg_id as clientMsgId, user_id as userId, username, room, content, timestamp
           FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT ?`
        )
        .all(room, limit) as ChatMessage[];
      return rows.reverse();
    },

    close() {
      db.close();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
