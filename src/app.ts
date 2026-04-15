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
const memoryCommunityPosts: {
  id: string;
  text: string;
  imageDataUrl: string | null;
  createdAt: string;
  author: "admin";
}[] = [];
const memoryAnalytics: {
  id: string;
  classId: string;
  className: string;
  resetAt: string;
  type: "manual" | "auto";
  studentsBefore: { name: string; coins: number }[];
}[] = [];
const memoryAutoReset: {
  id: string;
  classId: string;
  firstCoinAt: string;
  lastResetAt: string | null;
}[] = [];
const ADMIN_USER = process.env.ADMIN_USER || "admin2026";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "112212";
const JWT_SECRET = process.env.JWT_SECRET || ADMIN_PASSWORD || "ozone-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const ALLOWED_ORIGINS = new Set(
  [
    "http://ozone-coin.online",
    "https://ozone-coin.online",
    "http://www.ozone-coin.online",
    "https://www.ozone-coin.online",
    CORS_ORIGIN,
  ].filter(Boolean)
);

function isPrivateIpv4(hostname: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    const isHttp = protocol === "http:" || protocol === "https:";
    if (!isHttp) return false;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }

    return isPrivateIpv4(hostname);
  } catch {
    return false;
  }
}

function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  if (!origin) return cb(null, true);
  cb(null, isAllowedOrigin(origin));
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
function getCommunityPostsCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      text: string;
      imageDataUrl: string | null;
      createdAt: string;
      author: "admin";
    }>("community_posts")
  );
}
function getAnalyticsCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      classId: string;
      className: string;
      resetAt: string;
      type: "manual" | "auto";
      studentsBefore: { name: string; coins: number }[];
    }>("reset_analytics")
  );
}
function getAutoResetCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      classId: string;
      firstCoinAt: string;
      lastResetAt: string | null;
    }>("auto_reset_tracking")
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
app.use(express.json({ limit: "10mb" }));

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

app.get("/api/community-posts", async (_req, res) => {
  if (useMemoryStorage) {
    return res.json([...memoryCommunityPosts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  try {
    const col = await getCommunityPostsCol();
    const list = await col.find({}).sort({ createdAt: -1 }).toArray();
    return res.json(
      list.map((post) => ({
        id: post._id?.toString(),
        text: post.text || "",
        imageDataUrl: post.imageDataUrl || null,
        createdAt: post.createdAt,
        author: "admin" as const,
      }))
    );
  } catch (e) {
    console.error("GET /api/community-posts error:", e);
    return res.status(200).json([]);
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

app.post("/api/community-posts", requireAdmin, async (req, res) => {
  const trimmedText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const imageDataUrl =
    typeof req.body?.imageDataUrl === "string" && req.body.imageDataUrl.startsWith("data:image/")
      ? req.body.imageDataUrl
      : null;

  if (!trimmedText && !imageDataUrl) {
    return res.status(400).json({ error: "Text or image is required" });
  }
  if (imageDataUrl && imageDataUrl.length > 8_000_000) {
    return res.status(400).json({ error: "Image is too large" });
  }

  const entry = {
    text: trimmedText,
    imageDataUrl,
    createdAt: new Date().toISOString(),
    author: "admin" as const,
  };

  if (useMemoryStorage) {
    const id = new ObjectId().toString();
    const post = { id, ...entry };
    memoryCommunityPosts.unshift(post);
    return res.json(post);
  }

  try {
    const col = await getCommunityPostsCol();
    const result = await col.insertOne(entry);
    return res.json({ id: result.insertedId.toString(), ...entry });
  } catch (e) {
    console.error("POST /api/community-posts error:", e);
    return res.status(500).json({ error: "Failed to create community post" });
  }
});

app.delete("/api/community-posts/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (useMemoryStorage) {
    const idx = memoryCommunityPosts.findIndex((p) => p.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    memoryCommunityPosts.splice(idx, 1);
    return res.json({ success: true });
  }
  try {
    const oid = new ObjectId(id);
    const col = await getCommunityPostsCol();
    const r = await col.deleteOne({ _id: oid });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/community-posts/:id error:", e);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

app.put("/api/community-posts/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const trimmedText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const imageDataUrl =
    typeof req.body?.imageDataUrl === "string" && req.body.imageDataUrl.startsWith("data:image/")
      ? req.body.imageDataUrl
      : null;
  const keepImage = req.body?.keepImage === true;

  if (!trimmedText && !imageDataUrl && !keepImage) {
    return res.status(400).json({ error: "Text or image is required" });
  }

  if (useMemoryStorage) {
    const post = memoryCommunityPosts.find((p) => p.id === id);
    if (!post) return res.status(404).json({ error: "Not found" });
    post.text = trimmedText;
    if (imageDataUrl) post.imageDataUrl = imageDataUrl;
    else if (!keepImage) post.imageDataUrl = null;
    return res.json(post);
  }

  try {
    const oid = new ObjectId(id);
    const col = await getCommunityPostsCol();
    const update: Record<string, unknown> = { text: trimmedText };
    if (imageDataUrl) update.imageDataUrl = imageDataUrl;
    else if (!keepImage) update.imageDataUrl = null;
    const updated = await col.findOneAndUpdate(
      { _id: oid },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({
      id: updated._id?.toString(),
      text: updated.text || "",
      imageDataUrl: updated.imageDataUrl || null,
      createdAt: updated.createdAt,
      author: "admin" as const,
    });
  } catch (e) {
    console.error("PUT /api/community-posts/:id error:", e);
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.get("/api/analytics", async (_req, res) => {
  if (useMemoryStorage) {
    return res.json([...memoryAnalytics].sort((a, b) => b.resetAt.localeCompare(a.resetAt)));
  }
  try {
    const col = await getAnalyticsCol();
    const list = await col.find({}).sort({ resetAt: -1 }).toArray();
    return res.json(
      list.map((a) => ({
        id: a._id?.toString(),
        classId: a.classId,
        className: a.className,
        resetAt: a.resetAt,
        type: a.type,
        studentsBefore: a.studentsBefore,
      }))
    );
  } catch (e) {
    console.error("GET /api/analytics error:", e);
    return res.status(200).json([]);
  }
});

app.post("/api/classes/:classId/reset-coins", requireAdmin, async (req, res) => {
  const classId = req.params.classId;

  if (useMemoryStorage) {
    const cls = memoryClasses.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: "Class not found" });
    const classStudents = memoryStudents.filter((s) => s.classId === classId);
    const studentsBefore = classStudents.map((s) => ({ name: s.name, coins: s.coins }));
    classStudents.forEach((s) => { s.coins = 0; });
    const entry = {
      id: new ObjectId().toString(),
      classId,
      className: cls.name,
      resetAt: new Date().toISOString(),
      type: "manual" as const,
      studentsBefore,
    };
    memoryAnalytics.push(entry);
    const arIdx = memoryAutoReset.findIndex((a) => a.classId === classId);
    if (arIdx !== -1) {
      memoryAutoReset[arIdx].lastResetAt = entry.resetAt;
      memoryAutoReset[arIdx].firstCoinAt = entry.resetAt;
    }
    return res.json(entry);
  }

  try {
    const classOid = new ObjectId(classId);
    const classesCol = await getClassesCol();
    const cls = await classesCol.findOne({ _id: classOid });
    if (!cls) return res.status(404).json({ error: "Class not found" });

    const studentsCol = await getStudentsCol();
    const studentsList = await studentsCol.find({ classId: classOid }).toArray();
    const studentsBefore = studentsList.map((s) => ({ name: s.name, coins: s.coins }));

    await studentsCol.updateMany({ classId: classOid }, { $set: { coins: 0 } });

    const analyticsEntry = {
      classId,
      className: cls.name,
      resetAt: new Date().toISOString(),
      type: "manual" as const,
      studentsBefore,
    };
    const analyticsCol = await getAnalyticsCol();
    const result = await analyticsCol.insertOne(analyticsEntry);

    const autoResetCol = await getAutoResetCol();
    await autoResetCol.updateOne(
      { classId },
      { $set: { lastResetAt: analyticsEntry.resetAt, firstCoinAt: analyticsEntry.resetAt } }
    );

    return res.json({ id: result.insertedId.toString(), ...analyticsEntry });
  } catch (e) {
    console.error("POST /api/classes/:classId/reset-coins error:", e);
    return res.status(500).json({ error: "Failed to reset coins" });
  }
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
    if (num > 0) {
      const existing = memoryAutoReset.find((a) => a.classId === s.classId);
      if (!existing) {
        memoryAutoReset.push({
          id: new ObjectId().toString(),
          classId: s.classId,
          firstCoinAt: new Date().toISOString(),
          lastResetAt: null,
        });
      }
    }
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

    if (num > 0) {
      const autoResetCol = await getAutoResetCol();
      const classId = updated.classId.toString();
      const existing = await autoResetCol.findOne({ classId });
      if (!existing) {
        await autoResetCol.insertOne({
          classId,
          firstCoinAt: new Date().toISOString(),
          lastResetAt: null,
        });
      }
    }

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

const AUTO_RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function checkAutoResets() {
  const now = Date.now();

  if (useMemoryStorage) {
    for (const ar of memoryAutoReset) {
      const referenceDate = ar.lastResetAt || ar.firstCoinAt;
      if (now - new Date(referenceDate).getTime() >= AUTO_RESET_INTERVAL_MS) {
        const cls = memoryClasses.find((c) => c.id === ar.classId);
        if (!cls) continue;
        const classStudents = memoryStudents.filter((s) => s.classId === ar.classId);
        const studentsBefore = classStudents.map((s) => ({ name: s.name, coins: s.coins }));
        classStudents.forEach((s) => { s.coins = 0; });
        const resetAt = new Date().toISOString();
        memoryAnalytics.push({
          id: new ObjectId().toString(),
          classId: ar.classId,
          className: cls.name,
          resetAt,
          type: "auto",
          studentsBefore,
        });
        ar.lastResetAt = resetAt;
        ar.firstCoinAt = resetAt;
        console.log(`[Auto-reset] Class "${cls.name}" coins reset (memory)`);
      }
    }
    return;
  }

  try {
    const autoResetCol = await getAutoResetCol();
    const trackings = await autoResetCol.find({}).toArray();

    for (const tracking of trackings) {
      const referenceDate = tracking.lastResetAt || tracking.firstCoinAt;
      if (now - new Date(referenceDate).getTime() >= AUTO_RESET_INTERVAL_MS) {
        const classOid = new ObjectId(tracking.classId);
        const classesCol = await getClassesCol();
        const cls = await classesCol.findOne({ _id: classOid });
        if (!cls) continue;

        const studentsCol = await getStudentsCol();
        const studentsList = await studentsCol.find({ classId: classOid }).toArray();
        const studentsBefore = studentsList.map((s) => ({ name: s.name, coins: s.coins }));

        await studentsCol.updateMany({ classId: classOid }, { $set: { coins: 0 } });

        const resetAt = new Date().toISOString();
        const analyticsCol = await getAnalyticsCol();
        await analyticsCol.insertOne({
          classId: tracking.classId,
          className: cls.name,
          resetAt,
          type: "auto",
          studentsBefore,
        });

        await autoResetCol.updateOne(
          { _id: tracking._id },
          { $set: { lastResetAt: resetAt, firstCoinAt: resetAt } }
        );

        console.log(`[Auto-reset] Class "${cls.name}" coins reset (MongoDB)`);
      }
    }
  } catch (e) {
    console.error("[Auto-reset] Error:", e);
  }
}

checkAutoResets();
setInterval(checkAutoResets, 60 * 60 * 1000);

export default app;
