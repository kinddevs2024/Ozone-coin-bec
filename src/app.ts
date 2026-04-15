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
const memoryStudents: {
  id: string;
  name: string;
  coins: number;
  classId: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  initialPassword: string | null;
}[] = [];
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
const memoryAssignments: {
  id: string;
  studentId: string;
  classId: string;
  title: string;
  text: string;
  imageDataUrl: string | null;
  link: string | null;
  createdAt: string;
  dueAt: string | null;
  answerText: string | null;
  answerImageDataUrl: string | null;
  answerLink: string | null;
  answeredAt: string | null;
}[] = [];
const memoryCoinTransactions: {
  id: string;
  studentId: string;
  classId: string;
  amount: number;
  type: "admin_update" | "reset";
  note: string;
  createdAt: string;
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
    db.collection<{
      _id?: ObjectId;
      name: string;
      coins: number;
      classId: ObjectId;
      email: string;
      phone?: string | null;
      passwordHash: string;
      mustChangePassword: boolean;
      initialPassword?: string | null;
    }>("students")
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
function getAssignmentsCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      studentId: string;
      classId: string;
      title: string;
      text: string;
      imageDataUrl: string | null;
      link: string | null;
      createdAt: string;
      dueAt: string | null;
      answerText: string | null;
      answerImageDataUrl: string | null;
      answerLink: string | null;
      answeredAt: string | null;
    }>("assignments")
  );
}
function getCoinTransactionsCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      studentId: string;
      classId: string;
      amount: number;
      type: "admin_update" | "reset";
      note: string;
      createdAt: string;
    }>("coin_transactions")
  );
}

function signToken(payload: { a: number; exp: number }): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}
function signStudentToken(payload: { s: string; p: 2; exp: number }): string {
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
function verifyStudentToken(token: string): { sid: string } | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(payloadB64).digest("base64url");
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
      s?: string;
      p?: number;
      exp?: number;
    };
    if (payload.p !== 2 || !payload.s || !payload.exp || payload.exp < Date.now()) return null;
    return { sid: payload.s };
  } catch {
    return null;
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
function requireStudent(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const data = token ? verifyStudentToken(token) : null;
  if (!data) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as express.Request & { studentId?: string }).studentId = data.sid;
  next();
}

function slugifyName(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return name
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => map[ch] ?? "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "student";
}
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 4);
}
function randomTempPassword(): string {
  return Math.random().toString(36).slice(2, 10);
}
function hashPassword(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function getMonthKey(iso: string): string {
  return iso.slice(0, 7);
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

app.get("/api/admin/classes/:classId/students", requireAdmin, async (req, res) => {
  const classId = req.params.classId;
  if (useMemoryStorage) {
    const list = memoryStudents
      .filter((s) => s.classId === classId)
      .sort((a, b) => b.coins - a.coins)
      .map((s) => ({
        id: s.id,
        name: s.name,
        coins: s.coins,
        class_id: s.classId,
        email: s.email,
        mustChangePassword: s.mustChangePassword,
        initialPassword: s.initialPassword,
      }));
    return res.json(list);
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
    return res.json(
      list.map((s) => ({
        id: s._id?.toString(),
        name: s.name,
        coins: s.coins,
        class_id: s.classId.toString(),
        email: s.email,
        mustChangePassword: s.mustChangePassword,
        initialPassword: s.initialPassword ?? null,
      }))
    );
  } catch (e) {
    console.error("GET /api/admin/classes/:id/students error:", e);
    return res.status(200).json([]);
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

app.post("/api/student/login", async (req, res) => {
  const identifier = String(req.body?.identifier ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!identifier || !password) return res.status(400).json({ error: "identifier and password required" });

  if (useMemoryStorage) {
    const st = memoryStudents.find((s) => s.email.toLowerCase() === identifier || (s.phone && s.phone === identifier));
    if (!st) return res.status(401).json({ error: "Invalid credentials" });
    if (st.passwordHash !== hashPassword(password)) return res.status(401).json({ error: "Invalid credentials" });
    const token = signStudentToken({ s: st.id, p: 2, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.json({
      ok: true,
      token,
      mustChangePassword: st.mustChangePassword,
      student: { id: st.id, name: st.name, email: st.email, class_id: st.classId, coins: st.coins },
    });
  }

  try {
    const col = await getStudentsCol();
    const st = await col.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!st) return res.status(401).json({ error: "Invalid credentials" });
    if (st.passwordHash !== hashPassword(password)) return res.status(401).json({ error: "Invalid credentials" });
    const token = signStudentToken({ s: st._id!.toString(), p: 2, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.json({
      ok: true,
      token,
      mustChangePassword: st.mustChangePassword,
      student: { id: st._id?.toString(), name: st.name, email: st.email, class_id: st.classId.toString(), coins: st.coins },
    });
  } catch (e) {
    console.error("POST /api/student/login error:", e);
    return res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/api/student/change-password", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  const newPassword = String(req.body?.newPassword ?? "");
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password too short" });

  if (useMemoryStorage) {
    const st = memoryStudents.find((s) => s.id === studentId);
    if (!st) return res.status(404).json({ error: "Student not found" });
    st.passwordHash = hashPassword(newPassword);
    st.mustChangePassword = false;
    st.initialPassword = null;
    return res.json({ ok: true });
  }

  try {
    const col = await getStudentsCol();
    const oid = new ObjectId(studentId);
    const r = await col.updateOne(
      { _id: oid },
      { $set: { passwordHash: hashPassword(newPassword), mustChangePassword: false, initialPassword: null } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: "Student not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/student/change-password error:", e);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

app.get("/api/student/me", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });
  if (useMemoryStorage) {
    const st = memoryStudents.find((s) => s.id === studentId);
    if (!st) return res.status(404).json({ error: "Student not found" });
    return res.json({ id: st.id, name: st.name, email: st.email, class_id: st.classId, coins: st.coins });
  }
  try {
    const col = await getStudentsCol();
    const st = await col.findOne({ _id: new ObjectId(studentId) });
    if (!st) return res.status(404).json({ error: "Student not found" });
    return res.json({
      id: st._id?.toString(),
      name: st.name,
      email: st.email,
      class_id: st.classId.toString(),
      coins: st.coins,
    });
  } catch (e) {
    console.error("GET /api/student/me error:", e);
    return res.status(500).json({ error: "Failed to get student profile" });
  }
});

app.get("/api/student/assignments", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });
  if (useMemoryStorage) {
    const list = memoryAssignments
      .filter((a) => a.studentId === studentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json(list);
  }
  try {
    const col = await getAssignmentsCol();
    const list = await col.find({ studentId }).sort({ createdAt: -1 }).toArray();
    return res.json(list.map((a) => ({ id: a._id?.toString(), ...a })));
  } catch (e) {
    console.error("GET /api/student/assignments error:", e);
    return res.status(500).json({ error: "Failed to get assignments" });
  }
});

app.post("/api/student/assignments/:id/answer", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  const id = req.params.id;
  const answerText = typeof req.body?.answerText === "string" ? req.body.answerText.trim() : "";
  const answerImageRaw = typeof req.body?.answerImageDataUrl === "string" ? req.body.answerImageDataUrl.trim() : "";
  const answerImageDataUrl =
    answerImageRaw.startsWith("data:image/") || /^https?:\/\//i.test(answerImageRaw) ? answerImageRaw : null;
  const answerLink = typeof req.body?.answerLink === "string" ? req.body.answerLink.trim() : null;
  if (!answerText && !answerImageDataUrl && !answerLink) {
    return res.status(400).json({ error: "Answer is required" });
  }
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });
  const answeredAt = new Date().toISOString();

  if (useMemoryStorage) {
    const a = memoryAssignments.find((x) => x.id === id && x.studentId === studentId);
    if (!a) return res.status(404).json({ error: "Assignment not found" });
    a.answerText = answerText || null;
    a.answerImageDataUrl = answerImageDataUrl;
    a.answerLink = answerLink;
    a.answeredAt = answeredAt;
    return res.json({ ok: true, assignment: a });
  }
  try {
    const col = await getAssignmentsCol();
    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id), studentId },
      {
        $set: {
          answerText: answerText || null,
          answerImageDataUrl,
          answerLink,
          answeredAt,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Assignment not found" });
    return res.json({ ok: true, assignment: { id: updated._id?.toString(), ...updated } });
  } catch (e) {
    console.error("POST /api/student/assignments/:id/answer error:", e);
    return res.status(500).json({ error: "Failed to submit answer" });
  }
});

app.get("/api/student/coin-history", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });
  const grouped: Record<string, Array<{ amount: number; type: string; note: string; createdAt: string }>> = {};
  if (useMemoryStorage) {
    const tx = memoryCoinTransactions
      .filter((t) => t.studentId === studentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const t of tx) {
      const key = getMonthKey(t.createdAt);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ amount: t.amount, type: t.type, note: t.note, createdAt: t.createdAt });
    }
    return res.json(grouped);
  }
  try {
    const col = await getCoinTransactionsCol();
    const tx = await col.find({ studentId }).sort({ createdAt: -1 }).toArray();
    for (const t of tx) {
      const key = getMonthKey(t.createdAt);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ amount: t.amount, type: t.type, note: t.note, createdAt: t.createdAt });
    }
    return res.json(grouped);
  } catch (e) {
    console.error("GET /api/student/coin-history error:", e);
    return res.status(500).json({ error: "Failed to get coin history" });
  }
});

app.post("/api/admin/logout", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/assignments", requireAdmin, async (req, res) => {
  const studentId = String(req.body?.studentId ?? "").trim();
  const classId = String(req.body?.classId ?? "").trim();
  const title = String(req.body?.title ?? "").trim();
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const imageDataUrlRaw = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
  const imageDataUrl =
    imageDataUrlRaw.startsWith("data:image/") || /^https?:\/\//i.test(imageDataUrlRaw) ? imageDataUrlRaw : null;
  const link = typeof req.body?.link === "string" ? req.body.link.trim() : null;
  const dueAtRaw = typeof req.body?.dueAt === "string" ? req.body.dueAt.trim() : "";
  const dueDate = dueAtRaw ? new Date(dueAtRaw) : null;
  const dueAt = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null;
  if (!studentId || !classId) return res.status(400).json({ error: "studentId and classId required" });
  if (!title) return res.status(400).json({ error: "title required" });
  if (!text && !imageDataUrl && !link) return res.status(400).json({ error: "text/image/link required" });

  const createdAt = new Date().toISOString();
  if (useMemoryStorage) {
    const st = memoryStudents.find((s) => s.id === studentId && s.classId === classId);
    if (!st) return res.status(404).json({ error: "Student not found" });
    const assignment = {
      id: new ObjectId().toString(),
      studentId,
      classId,
      title,
      text,
      imageDataUrl,
      link,
      createdAt,
      dueAt,
      answerText: null,
      answerImageDataUrl: null,
      answerLink: null,
      answeredAt: null,
    };
    memoryAssignments.push(assignment);
    return res.json(assignment);
  }

  try {
    const studentsCol = await getStudentsCol();
    const st = await studentsCol.findOne({ _id: new ObjectId(studentId), classId: new ObjectId(classId) });
    if (!st) return res.status(404).json({ error: "Student not found" });
    const col = await getAssignmentsCol();
    const doc = {
      studentId,
      classId,
      title,
      text,
      imageDataUrl,
      link,
      createdAt,
      dueAt,
      answerText: null,
      answerImageDataUrl: null,
      answerLink: null,
      answeredAt: null,
    };
    const result = await col.insertOne(doc);
    return res.json({ id: result.insertedId.toString(), ...doc });
  } catch (e) {
    console.error("POST /api/assignments error:", e);
    return res.status(500).json({ error: "Failed to create assignment" });
  }
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
    const resetAt = new Date().toISOString();
    for (const s of classStudents) {
      if (s.coins !== 0) {
        memoryCoinTransactions.push({
          id: new ObjectId().toString(),
          studentId: s.id,
          classId,
          amount: -s.coins,
          type: "reset",
          note: "Monthly/manual reset",
          createdAt: resetAt,
        });
      }
      s.coins = 0;
    }
    const entry = {
      id: new ObjectId().toString(),
      classId,
      className: cls.name,
      resetAt,
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
    const txCol = await getCoinTransactionsCol();
    const resetAt = new Date().toISOString();
    for (const s of studentsList) {
      if (s.coins !== 0) {
        await txCol.insertOne({
          studentId: s._id!.toString(),
          classId,
          amount: -s.coins,
          type: "reset",
          note: "Monthly/manual reset",
          createdAt: resetAt,
        });
      }
    }

    const analyticsEntry = {
      classId,
      className: cls.name,
      resetAt,
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
  const trimmedName = String(name).trim();
  if (useMemoryStorage) {
    const exists = memoryClasses.some((c) => c.id === cidStr);
    if (!exists) return res.status(400).json({ error: "Invalid classId" });
    const baseEmail = `${slugifyName(trimmedName)}@ozonecoin.uz`;
    let email = baseEmail;
    while (memoryStudents.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
      email = `${slugifyName(trimmedName)}${randomSuffix()}@ozonecoin.uz`;
    }
    const tempPassword = randomTempPassword();
    const id = new ObjectId().toString();
    const entry = {
      id,
      name: trimmedName,
      coins: 0,
      classId: cidStr,
      email,
      phone: null,
      passwordHash: hashPassword(tempPassword),
      mustChangePassword: true,
      initialPassword: tempPassword,
    };
    memoryStudents.push(entry);
    return res.json({
      id,
      name: entry.name,
      class_id: cidStr,
      coins: 0,
      email: entry.email,
      mustChangePassword: true,
      initialPassword: tempPassword,
    });
  }
  let cid: ObjectId;
  try {
    cid = new ObjectId(classId);
  } catch {
    return res.status(400).json({ error: "Invalid classId" });
  }
  try {
    const col = await getStudentsCol();
    const baseEmail = `${slugifyName(trimmedName)}@ozonecoin.uz`;
    let email = baseEmail;
    while (await col.findOne({ email })) {
      email = `${slugifyName(trimmedName)}${randomSuffix()}@ozonecoin.uz`;
    }
    const tempPassword = randomTempPassword();
    const result = await col.insertOne({
      name: trimmedName,
      classId: cid,
      coins: 0,
      email,
      phone: null,
      passwordHash: hashPassword(tempPassword),
      mustChangePassword: true,
      initialPassword: tempPassword,
    });
    res.json({
      id: result.insertedId.toString(),
      name: trimmedName,
      class_id: classId,
      coins: 0,
      email,
      mustChangePassword: true,
      initialPassword: tempPassword,
    });
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
    memoryCoinTransactions.push({
      id: new ObjectId().toString(),
      studentId: s.id,
      classId: s.classId,
      amount: num,
      type: "admin_update",
      note: `Admin update ${num > 0 ? "+" : ""}${num}`,
      createdAt: new Date().toISOString(),
    });
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
    const txCol = await getCoinTransactionsCol();
    await txCol.insertOne({
      studentId: updated._id!.toString(),
      classId: updated.classId.toString(),
      amount: num,
      type: "admin_update",
      note: `Admin update ${num > 0 ? "+" : ""}${num}`,
      createdAt: new Date().toISOString(),
    });

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
        const resetAt = new Date().toISOString();
        for (const s of classStudents) {
          if (s.coins !== 0) {
            memoryCoinTransactions.push({
              id: new ObjectId().toString(),
              studentId: s.id,
              classId: ar.classId,
              amount: -s.coins,
              type: "reset",
              note: "Monthly auto reset",
              createdAt: resetAt,
            });
          }
          s.coins = 0;
        }
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
        const txCol = await getCoinTransactionsCol();
        for (const s of studentsList) {
          if (s.coins !== 0) {
            await txCol.insertOne({
              studentId: s._id!.toString(),
              classId: tracking.classId,
              amount: -s.coins,
              type: "reset",
              note: "Monthly auto reset",
              createdAt: resetAt,
            });
          }
        }
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
