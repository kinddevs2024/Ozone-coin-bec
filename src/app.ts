/**
 * Backend API: данные в MongoDB или в памяти (если MongoDB недоступен / плейсхолдер в .env).
 * Standalone Express server. Set MONGODB_URI, CORS_ORIGIN in .env.
 */
import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import cors from "cors";

const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = "Ozone-coin";

/** Использовать память вместо MongoDB: URI пустой или плейсхолдер (нет реального подключения). */
const useMemoryStorage = !MONGODB_URI?.trim() || MONGODB_URI.includes("USER:PASSWORD");

const memoryClasses: { id: string; name: string }[] = [];
const memoryStudents: { id: string; name: string; coins: number; classId: string }[] = [];
const ADMIN_USER = process.env.ADMIN_USER || "admin2026";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "112212";
const JWT_SECRET = process.env.JWT_SECRET || ADMIN_PASSWORD || "ozone-secret";
// Разрешаем и http, и https для ozone-coin.online (чтобы работало до и после SSL)
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://ozone-coin.online",
  "https://ozone-coin.online",
  "http://www.ozone-coin.online",
  "https://www.ozone-coin.online",
  CORS_ORIGIN,
].filter(Boolean);
function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  if (!origin) return cb(null, true);
  const allow = ALLOWED_ORIGINS.some((o) => origin === o);
  cb(null, allow);
}

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!MONGODB_URI?.trim()) throw new Error("MONGODB_URI not set");
  if (!clientPromise) clientPromise = new MongoClient(MONGODB_URI).connect();
  return clientPromise;
}

async function getDb() {
  return (await getClient()).db(DB_NAME);
}

function getClassesCol() {
  return getDb().then((db) => db.collection<{ _id?: ObjectId; name: string }>("classes"));
}
function getStudentsCol() {
  return getDb().then((db) =>
    db.collection<{ _id?: ObjectId; name: string; coins: number; classId: ObjectId }>("students")
  );
}

function signToken(payload: { a: number; exp: number }): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}
function verifyToken(token: string): boolean {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(payloadB64).digest("base64url");
    if (expected !== sig) return false;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as { a?: number; exp?: number };
    if (payload.a !== 1 || !payload.exp || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const app = express();
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

function getClientIp(req: express.Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = typeof forwarded === "string" ? forwarded.split(",")[0] : forwarded[0];
    if (first) return first.trim();
  }
  const real = req.headers["x-real-ip"];
  if (real && typeof real === "string") return real.trim();
  return req.socket?.remoteAddress ?? "unknown";
}

app.get("/api/health", async (req, res) => {
  const ip = getClientIp(req);
  const started = new Date().toISOString();
  let db: "ok" | "error" = "ok";
  if (MONGODB_URI) {
    try {
      await getClient().then((c) => c.db(DB_NAME).command({ ping: 1 }));
    } catch {
      db = "error";
    }
  } else {
    db = "error";
  }
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok", timestamp: started, ip, db });
});

app.get("/api/classes", async (_req, res) => {
  if (useMemoryStorage) return res.json(memoryClasses.map((c) => ({ id: c.id, name: c.name })));
  try {
    const col = await getClassesCol();
    const list = await col.find({}).project({ _id: 1, name: 1 }).toArray();
    return res.json(list.map((c) => ({ id: c._id?.toString(), name: c.name })));
  } catch (e) {
    console.error("GET /api/classes error:", e);
    return res.status(200).json([]);
  }
});

app.get("/api/classes/:classId/students", async (req, res) => {
  const classId = req.params.classId;
  if (useMemoryStorage) {
    const list = memoryStudents.filter((s) => s.classId === classId).sort((a, b) => b.coins - a.coins);
    return res.json(list.map((s) => ({ id: s.id, name: s.name, coins: s.coins, class_id: s.classId })));
  }
  let id: ObjectId;
  try {
    id = new ObjectId(classId);
  } catch {
    return res.status(400).json({ error: "Invalid class id" });
  }
  try {
    const col = await getStudentsCol();
    const list = await col.find({ classId: id }).sort({ coins: -1 }).toArray();
    res.json(
      list.map((s) => ({
        id: s._id?.toString(),
        name: s.name,
        coins: s.coins,
        class_id: s.classId.toString(),
      }))
    );
  } catch (e) {
    console.error("GET /api/classes/:id/students error:", e);
    res.json([]);
  }
});

app.post("/api/admin/login", (req, res) => {
  const { user, password } = req.body || {};
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
    const token = signToken({ a: 1, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

app.post("/api/admin/logout", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/classes", requireAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name required" });
  const trimmed = name.trim();
  if (useMemoryStorage) {
    const id = new ObjectId().toString();
    memoryClasses.push({ id, name: trimmed });
    return res.json({ id, name: trimmed });
  }
  try {
    const col = await getClassesCol();
    const result = await col.insertOne({ name: trimmed });
    res.json({ id: result.insertedId.toString(), name: trimmed });
  } catch (e: unknown) {
    console.error(e);
    res.status(500).json({ error: "Sinf qo'shib bo'lmadi", details: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/classes/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (useMemoryStorage) {
    const idx = memoryClasses.findIndex((c) => c.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    memoryClasses.splice(idx, 1);
    for (let i = memoryStudents.length - 1; i >= 0; i--) {
      if (memoryStudents[i].classId === id) memoryStudents.splice(i, 1);
    }
    return res.json({ success: true });
  }
  try {
    const oid = new ObjectId(id);
    const studentsCol = await getStudentsCol();
    const classesCol = await getClassesCol();
    await studentsCol.deleteMany({ classId: oid });
    const r = await classesCol.deleteOne({ _id: oid });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

app.post("/api/students", requireAdmin, async (req, res) => {
  const { name, classId } = req.body || {};
  if (!name || !classId) return res.status(400).json({ error: "name and classId required" });
  const cidStr = String(classId);
  if (useMemoryStorage) {
    const exists = memoryClasses.some((c) => c.id === cidStr);
    if (!exists) return res.status(400).json({ error: "Invalid classId" });
    const id = new ObjectId().toString();
    const entry = { id, name: String(name).trim(), coins: 0, classId: cidStr };
    memoryStudents.push(entry);
    return res.json({ id, name: entry.name, class_id: cidStr, coins: 0 });
  }
  let cid: ObjectId;
  try {
    cid = new ObjectId(classId);
  } catch {
    return res.status(400).json({ error: "Invalid classId" });
  }
  try {
    const col = await getStudentsCol();
    const result = await col.insertOne({ name: String(name).trim(), classId: cid, coins: 0 });
    res.json({ id: result.insertedId.toString(), name: String(name).trim(), class_id: classId, coins: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to add student" });
  }
});

app.delete("/api/students/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (useMemoryStorage) {
    const idx = memoryStudents.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    memoryStudents.splice(idx, 1);
    return res.json({ success: true });
  }
  try {
    const oid = new ObjectId(id);
    const col = await getStudentsCol();
    const r = await col.deleteOne({ _id: oid });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete student" });
  }
});

app.patch("/api/students/:id/coins", requireAdmin, async (req, res) => {
  const { amount } = req.body || {};
  const num = Number(amount);
  if (Number.isNaN(num)) return res.status(400).json({ error: "amount required" });
  const id = req.params.id;
  if (useMemoryStorage) {
    const s = memoryStudents.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: "Not found" });
    s.coins += num;
    return res.json({ id: s.id, name: s.name, coins: s.coins, class_id: s.classId });
  }
  try {
    const oid = new ObjectId(id);
    const col = await getStudentsCol();
    const updated = await col.findOneAndUpdate(
      { _id: oid },
      { $inc: { coins: num } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({
      id: updated._id?.toString(),
      name: updated.name,
      coins: updated.coins,
      class_id: updated.classId.toString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update coins" });
  }
});

export default app;
