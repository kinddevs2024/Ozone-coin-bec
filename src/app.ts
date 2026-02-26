/**
 * Backend API: все данные сохраняются только в MongoDB.
 * Standalone Express server. Set MONGODB_URI, CORS_ORIGIN in .env.
 */
import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import cors from "cors";

const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = "Ozone-coin";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const JWT_SECRET = process.env.JWT_SECRET || ADMIN_PASSWORD || "ozone-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

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
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
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
  try {
    if (!MONGODB_URI?.trim()) return res.json([]);
    const col = await getClassesCol();
    const list = await col.find({}).project({ _id: 1, name: 1 }).toArray();
    return res.json(list.map((c) => ({ id: c._id?.toString(), name: c.name })));
  } catch (e) {
    console.error("GET /api/classes error:", e);
    return res.status(200).json([]);
  }
});

app.get("/api/classes/:classId/students", async (req, res) => {
  let id: ObjectId;
  try {
    id = new ObjectId(req.params.classId);
  } catch {
    return res.status(400).json({ error: "Invalid class id" });
  }
  if (!MONGODB_URI?.trim()) return res.json([]);
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
  try {
    const col = await getClassesCol();
    const result = await col.insertOne({ name: name.trim() });
    res.json({ id: result.insertedId.toString(), name: name.trim() });
  } catch (e: unknown) {
    console.error(e);
    res.status(500).json({ error: "Sinf qo'shib bo'lmadi", details: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/classes/:id", requireAdmin, async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const studentsCol = await getStudentsCol();
    const classesCol = await getClassesCol();
    await studentsCol.deleteMany({ classId: id });
    const r = await classesCol.deleteOne({ _id: id });
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
  try {
    const id = new ObjectId(req.params.id);
    const col = await getStudentsCol();
    const r = await col.deleteOne({ _id: id });
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
  try {
    const id = new ObjectId(req.params.id);
    const col = await getStudentsCol();
    const updated = await col.findOneAndUpdate(
      { _id: id },
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
