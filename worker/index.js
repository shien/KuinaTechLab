import { DurableObject } from "cloudflare:workers";

const ROOM_ID_RE = /^[A-Za-z0-9_-]{10,48}$/;
const MAX_BODY_BYTES = 64 * 1024;
const VALID_SLOTS = new Set(["weekday", "holiday"]);
const VALID_PERIODS = new Set(["morning", "afternoon", "evening"]);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function generateRoomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sanitizeItems(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const limit = Math.min(rawList.length, 60);
  for (let i = 0; i < limit; i++) {
    const it = rawList[i];
    if (!it || typeof it !== "object") continue;
    const period = VALID_PERIODS.has(it.period) ? it.period : "morning";
    const uid =
      typeof it.uid === "string" && it.uid.length > 0 && it.uid.length <= 64
        ? it.uid
        : "item_" + i;
    const activityId =
      typeof it.activityId === "string" && /^[a-z0-9_-]{1,32}$/i.test(it.activityId)
        ? it.activityId
        : "wakeup";
    const time =
      typeof it.time === "string" && (/^\d{2}:\d{2}$/.test(it.time) || it.time === "")
        ? it.time
        : "";
    const label =
      typeof it.label === "string" ? it.label.trim().slice(0, 40) : "よてい";
    const note =
      typeof it.note === "string" ? it.note.trim().slice(0, 80) : "";
    out.push({
      uid,
      period,
      activityId,
      time,
      label: label || "よてい",
      note,
      done: Boolean(it.done)
    });
  }
  return out;
}

function sanitizePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slot = VALID_SLOTS.has(raw.slot) ? raw.slot : "weekday";
  const sched = raw.schedules && typeof raw.schedules === "object" ? raw.schedules : {};
  return {
    slot,
    schedules: {
      weekday: sanitizeItems(sched.weekday),
      holiday: sanitizeItems(sched.holiday)
    }
  };
}

async function readLimitedJson(request) {
  const lenHeader = request.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return { error: "payload_too_large" };
  }
  if (!request.body) {
    return { error: "empty_body" };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder().decode(merged);
    return { data: JSON.parse(text) };
  } catch (_) {
    return { error: "invalid_json" };
  }
}

export class ScheduleRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS schedule_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    });
  }

  async getSchedule() {
    const rows = this.ctx.storage.sql
      .exec("SELECT payload, updated_at FROM schedule_state WHERE id = 1")
      .toArray();
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      ...JSON.parse(row.payload),
      updatedAt: Number(row.updated_at) || 0
    };
  }

  async saveSchedule(payload) {
    const now = Date.now();
    const serialized = JSON.stringify(payload);
    this.ctx.storage.sql.exec(
      `INSERT INTO schedule_state (id, payload, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      serialized,
      now
    );
    return { updatedAt: now };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/schedule")) {
      return handleScheduleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleScheduleApi(request, env, url) {
  if (!env.SCHEDULE_ROOMS) {
    return jsonResponse({ error: "storage_unavailable" }, 503);
  }

  // POST /api/schedule/create
  if (url.pathname === "/api/schedule/create" && request.method === "POST") {
    const parsed = await readLimitedJson(request);
    if (parsed.error === "payload_too_large") {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    if (parsed.error) {
      return jsonResponse({ error: parsed.error }, 400);
    }
    const payload = sanitizePayload(parsed.data);
    if (!payload) {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const roomId = generateRoomId();
    const stub = env.SCHEDULE_ROOMS.getByName(roomId);
    const saved = await stub.saveSchedule(payload);
    return jsonResponse({ roomId, updatedAt: saved.updatedAt }, 201);
  }

  // GET or PUT /api/schedule/:roomId
  const match = url.pathname.match(/^\/api\/schedule\/([A-Za-z0-9_-]+)$/);
  if (!match) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  const roomId = match[1];
  if (!ROOM_ID_RE.test(roomId)) {
    return jsonResponse({ error: "invalid_room_id" }, 400);
  }

  const stub = env.SCHEDULE_ROOMS.getByName(roomId);

  if (request.method === "GET") {
    const record = await stub.getSchedule();
    if (!record) {
      return jsonResponse({ error: "room_not_found" }, 404);
    }
    return jsonResponse({ roomId, ...record }, 200);
  }

  if (request.method === "PUT") {
    const parsed = await readLimitedJson(request);
    if (parsed.error === "payload_too_large") {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    if (parsed.error) {
      return jsonResponse({ error: parsed.error }, 400);
    }
    const payload = sanitizePayload(parsed.data);
    if (!payload) {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const saved = await stub.saveSchedule(payload);
    return jsonResponse({ ok: true, roomId, updatedAt: saved.updatedAt }, 200);
  }

  return jsonResponse({ error: "method_not_allowed" }, 405);
}
