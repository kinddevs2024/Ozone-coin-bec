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
  reviewedAt: string | null;
  reviewComment: string | null;
  awardedCoins: number | null;
}[] = [];
type CoinTxType = "admin_update" | "reset" | "assignment_reward" | "weekly_activity_bonus" | "monthly_rank_bonus";

const memoryCoinTransactions: {
  id: string;
  studentId: string;
  classId: string;
  amount: number;
  type: CoinTxType;
  note: string;
  createdAt: string;
}[] = [];
/** Haftalik dars slotlari: weekday 0 = dushanba … 6 = yakshanba */
const memoryScheduleSlots: {
  id: string;
  classId: string;
  weekday: number;
  title: string;
  startTime: string;
  endTime: string;
}[] = [];
const memoryLessonAttendance: {
  id: string;
  classId: string;
  date: string;
  scheduleSlotId: string;
  studentId: string;
  present: boolean;
  updatedAt: string;
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
      reviewedAt: string | null;
      reviewComment: string | null;
      awardedCoins?: number | null;
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
      type: CoinTxType;
      note: string;
      createdAt: string;
    }>("coin_transactions")
  );
}
function getScheduleSlotsCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      classId: string;
      weekday: number;
      title: string;
      startTime: string;
      endTime: string;
    }>("schedule_slots")
  );
}
function getLessonAttendanceCol() {
  return getDb().then((db) =>
    db.collection<{
      _id?: ObjectId;
      classId: string;
      date: string;
      scheduleSlotId: string;
      studentId: string;
      present: boolean;
      updatedAt: string;
    }>("lesson_attendance")
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
function getDayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Dushanba 00:00 UTC — hafta kaliti sifatida YYYY-MM-DD */
function utcMondayDate(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function utcWeekBoundsFromTimestamp(iso: string): { start: string; end: string; weekKey: string } {
  const d = new Date(iso);
  const mon = utcMondayDate(d);
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 999);
  return {
    start: mon.toISOString(),
    end: sun.toISOString(),
    weekKey: formatUtcYmd(mon),
  };
}

const WEEKLY_BONUS_EXCLUDED: ReadonlySet<CoinTxType> = new Set([
  "reset",
  "weekly_activity_bonus",
  "monthly_rank_bonus",
]);

function weeklyActivityTargetBonus(qualifyingPositiveSum: number): number {
  if (qualifyingPositiveSum >= 100) return 15;
  if (qualifyingPositiveSum >= 75) return 10;
  if (qualifyingPositiveSum >= 50) return 5;
  return 0;
}

function computeWeeklyBonusDeltaMemory(studentId: string, classId: string, referenceIso: string): number {
  const { start, end, weekKey } = utcWeekBoundsFromTimestamp(referenceIso);
  let qualifying = 0;
  let already = 0;
  for (const t of memoryCoinTransactions) {
    if (t.studentId !== studentId || t.classId !== classId) continue;
    if (t.createdAt < start || t.createdAt > end) continue;
    if (t.type === "weekly_activity_bonus") {
      already += t.amount;
      continue;
    }
    if (WEEKLY_BONUS_EXCLUDED.has(t.type)) continue;
    if (t.amount > 0) qualifying += t.amount;
  }
  const target = weeklyActivityTargetBonus(qualifying);
  return Math.max(0, target - already);
}

async function computeWeeklyBonusDeltaMongo(studentId: string, classId: string, referenceIso: string): Promise<number> {
  const { start, end } = utcWeekBoundsFromTimestamp(referenceIso);
  const txCol = await getCoinTransactionsCol();
  const txs = await txCol
    .find({
      studentId,
      classId,
      createdAt: { $gte: start, $lte: end },
    })
    .toArray();
  let qualifying = 0;
  let already = 0;
  for (const t of txs) {
    const ty = t.type as CoinTxType;
    if (ty === "weekly_activity_bonus") {
      already += t.amount;
      continue;
    }
    if (WEEKLY_BONUS_EXCLUDED.has(ty)) continue;
    if (t.amount > 0) qualifying += t.amount;
  }
  const target = weeklyActivityTargetBonus(qualifying);
  return Math.max(0, target - already);
}

function applyWeeklyActivityBonusMemory(studentId: string, classId: string) {
  const nowIso = new Date().toISOString();
  for (let hop = 0; hop < 5; hop++) {
    const delta = computeWeeklyBonusDeltaMemory(studentId, classId, nowIso);
    if (delta <= 0) break;
    const s = memoryStudents.find((x) => x.id === studentId);
    if (!s) break;
    const { weekKey } = utcWeekBoundsFromTimestamp(nowIso);
    s.coins += delta;
    memoryCoinTransactions.push({
      id: new ObjectId().toString(),
      studentId,
      classId,
      amount: delta,
      type: "weekly_activity_bonus",
      note: `Haftalik faollik bonusi (${weekKey} haftasi, jami stavka bo'yicha +${delta})`,
      createdAt: nowIso,
    });
    ensureMemoryAutoResetTracking(classId, nowIso);
  }
}

async function applyWeeklyActivityBonusMongo(studentId: string, classId: string) {
  const nowIso = new Date().toISOString();
  for (let hop = 0; hop < 5; hop++) {
    const delta = await computeWeeklyBonusDeltaMongo(studentId, classId, nowIso);
    if (delta <= 0) break;
    const studentsCol = await getStudentsCol();
    const updated = await studentsCol.findOneAndUpdate(
      { _id: new ObjectId(studentId) },
      { $inc: { coins: delta } },
      { returnDocument: "after" }
    );
    if (!updated) break;
    const { weekKey } = utcWeekBoundsFromTimestamp(nowIso);
    const txCol = await getCoinTransactionsCol();
    await txCol.insertOne({
      studentId,
      classId,
      amount: delta,
      type: "weekly_activity_bonus",
      note: `Haftalik faollik bonusi (${weekKey} haftasi, jami stavka bo'yicha +${delta})`,
      createdAt: nowIso,
    });
    await ensureMongoAutoResetTracking(classId, nowIso);
  }
}

type RankRow = { id: string; name: string; coins: number };

const MONTHLY_RANK_AMOUNTS = [30, 20, 10] as const;

function grantMonthlyRankBonusesMemory(classId: string, ranked: RankRow[], resetAt: string) {
  const sorted = ranked.slice().sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
  for (let i = 0; i < 3 && i < sorted.length; i++) {
    const row = sorted[i]!;
    const amount = MONTHLY_RANK_AMOUNTS[i];
    if (amount <= 0) continue;
    const s = memoryStudents.find((x) => x.id === row.id);
    if (!s) continue;
    s.coins += amount;
    memoryCoinTransactions.push({
      id: new ObjectId().toString(),
      studentId: row.id,
      classId,
      amount,
      type: "monthly_rank_bonus",
      note: `Oy yakuni: sinf bo'yicha ${i + 1}-o'rin — keyingi davr boshlang'ich +${amount} coin`,
      createdAt: resetAt,
    });
  }
}

async function grantMonthlyRankBonusesMongo(classId: string, ranked: RankRow[], resetAt: string) {
  const sorted = ranked.slice().sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
  const studentsCol = await getStudentsCol();
  const txCol = await getCoinTransactionsCol();
  for (let i = 0; i < 3 && i < sorted.length; i++) {
    const row = sorted[i]!;
    const amount = MONTHLY_RANK_AMOUNTS[i];
    if (amount <= 0) continue;
    await studentsCol.updateOne({ _id: new ObjectId(row.id) }, { $inc: { coins: amount } });
    await txCol.insertOne({
      studentId: row.id,
      classId,
      amount,
      type: "monthly_rank_bonus",
      note: `Oy yakuni: sinf bo'yicha ${i + 1}-o'rin — keyingi davr boshlang'ich +${amount} coin`,
      createdAt: resetAt,
    });
  }
}

function utcMondayFromWeekStartParam(weekStart?: string): Date {
  const raw = typeof weekStart === "string" ? weekStart.trim() : "";
  const base = raw ? new Date(`${raw}T12:00:00.000Z`) : new Date();
  if (Number.isNaN(base.getTime())) return new Date();
  const dow = base.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + diff));
}

function addUtcDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function formatUtcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 0 = dushanba … 6 = yakshanba (ISO hafta boshidan) */
function mondayBasedWeekdayFromUtcDate(d: Date): number {
  const dow = d.getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}
function coerceNonNegativeInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}
function createDateRange(fromIso: string, toIso: string, mode: "day" | "month"): string[] {
  const out: string[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;

  if (mode === "month") {
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (current <= last) {
      out.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`);
      current.setUTCMonth(current.getUTCMonth() + 1);
    }
    return out;
  }

  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (current <= last) {
    out.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out;
}

function ensureMemoryAutoResetTracking(classId: string, createdAt: string) {
  const existing = memoryAutoReset.find((a) => a.classId === classId);
  if (!existing) {
    memoryAutoReset.push({
      id: new ObjectId().toString(),
      classId,
      firstCoinAt: createdAt,
      lastResetAt: null,
    });
  }
}

async function ensureMongoAutoResetTracking(classId: string, createdAt: string) {
  const autoResetCol = await getAutoResetCol();
  const existing = await autoResetCol.findOne({ classId });
  if (!existing) {
    await autoResetCol.insertOne({
      classId,
      firstCoinAt: createdAt,
      lastResetAt: null,
    });
  }
}

function createMemoryStudent(classId: string, name: string) {
  const trimmedName = String(name).trim();
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
    classId,
    email,
    phone: null,
    passwordHash: hashPassword(tempPassword),
    mustChangePassword: true,
    initialPassword: tempPassword,
  };
  memoryStudents.push(entry);
  return {
    id,
    name: entry.name,
    class_id: classId,
    coins: 0,
    email: entry.email,
    mustChangePassword: true,
    initialPassword: tempPassword,
  };
}

async function createMongoStudent(classId: string, name: string) {
  const trimmedName = String(name).trim();
  const cid = new ObjectId(classId);
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
  return {
    id: result.insertedId.toString(),
    name: trimmedName,
    class_id: classId,
    coins: 0,
    email,
    mustChangePassword: true,
    initialPassword: tempPassword,
  };
}

function buildCoinStatsResponse(args: {
  mode: "day" | "month" | "custom";
  from: string | null;
  to: string | null;
  transactions: { studentId: string; classId: string; amount: number; createdAt: string }[];
  students: { id: string; name: string; classId: string }[];
  classes: { id: string; name: string }[];
}) {
  const { mode, from, to, transactions, students, classes } = args;
  const bucketMode = mode === "month" ? "month" : "day";
  const txList = transactions.filter((tx) => tx.amount !== 0);
  const classMap = new Map(classes.map((cls) => [cls.id, cls.name]));
  const studentMap = new Map(
    students.map((student) => [
      student.id,
      {
        studentId: student.id,
        studentName: student.name,
        classId: student.classId,
        className: classMap.get(student.classId) ?? "Unknown",
        total: 0,
        values: {} as Record<string, number>,
      },
    ])
  );

  let columns: string[] = [];
  if (from && to) {
    columns = createDateRange(from, to, bucketMode);
  } else {
    const keys = new Set<string>();
    for (const tx of txList) {
      keys.add(bucketMode === "month" ? getMonthKey(tx.createdAt) : getDayKey(tx.createdAt));
    }
    columns = [...keys].sort();
  }

  for (const tx of txList) {
    const row = studentMap.get(tx.studentId);
    if (!row) continue;
    const key = bucketMode === "month" ? getMonthKey(tx.createdAt) : getDayKey(tx.createdAt);
    if (!columns.includes(key)) continue;
    row.values[key] = (row.values[key] ?? 0) + tx.amount;
    row.total += tx.amount;
  }

  const rows = [...studentMap.values()].filter((row) => row.total !== 0 || columns.some((column) => (row.values[column] ?? 0) !== 0));
  rows.sort((a, b) => a.className.localeCompare(b.className) || a.studentName.localeCompare(b.studentName));

  const grouped = new Map<string, { classId: string; className: string; rows: typeof rows }>();
  for (const row of rows) {
    const existing = grouped.get(row.classId);
    if (existing) {
      existing.rows.push(row);
    } else {
      grouped.set(row.classId, { classId: row.classId, className: row.className, rows: [row] });
    }
  }

  return {
    mode,
    from,
    to,
    columns,
    overall: rows,
    classes: [...grouped.values()].sort((a, b) => a.className.localeCompare(b.className)),
  };
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

function starsFromCoins(coins: number, maxCoins: number): number {
  if (maxCoins <= 0) return 1;
  const raw = Math.round((coins / maxCoins) * 4) + 1;
  return Math.max(1, Math.min(5, raw));
}

app.get("/api/classes/:classId/ratings", async (req, res) => {
  const classId = req.params.classId;
  const pageRaw = Number(req.query.page);
  const sizeRaw = Number(req.query.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? Math.floor(pageRaw) : 0;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(50, Math.floor(sizeRaw)) : 10;

  if (useMemoryStorage) {
    const list = memoryStudents
      .filter((s) => s.classId === classId)
      .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
    const total = list.length;
    const maxCoins = list[0]?.coins ?? 0;
    const start = page * pageSize;
    const slice = list.slice(start, start + pageSize);
    const items = slice.map((s, i) => ({
      id: s.id,
      name: s.name,
      coins: s.coins,
      stars: starsFromCoins(s.coins, maxCoins),
      rank: start + i + 1,
    }));
    return res.json({
      classId,
      total,
      page,
      pageSize,
      maxCoins,
      hasMore: start + slice.length < total,
      items,
    });
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(classId);
  } catch {
    return res.status(400).json({ error: "Invalid class id" });
  }
  try {
    const col = await getStudentsCol();
    const maxDoc = await col.find({ classId: oid }).sort({ coins: -1, name: 1 }).limit(1).toArray();
    const maxCoins = maxDoc[0]?.coins ?? 0;
    const total = await col.countDocuments({ classId: oid });
    const start = page * pageSize;
    const list = await col.find({ classId: oid }).sort({ coins: -1, name: 1 }).skip(start).limit(pageSize).toArray();
    const items = list.map((s, i) => ({
      id: s._id!.toString(),
      name: s.name,
      coins: s.coins,
      stars: starsFromCoins(s.coins, maxCoins),
      rank: start + i + 1,
    }));
    return res.json({
      classId,
      total,
      page,
      pageSize,
      maxCoins,
      hasMore: start + list.length < total,
      items,
    });
  } catch (e) {
    console.error("GET /api/classes/:classId/ratings error:", e);
    return res.status(500).json({ error: "Failed to load ratings" });
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

app.patch("/api/student/profile", requireStudent, async (req, res) => {
  const studentId = (req as express.Request & { studentId?: string }).studentId;
  if (!studentId) return res.status(401).json({ error: "Unauthorized" });

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  const updateName = name.length > 0;
  const updatePassword = newPassword.length > 0;
  if (!updateName && !updatePassword) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (updateName && name.length < 2) {
    return res.status(400).json({ error: "Name too short" });
  }
  if (updatePassword && newPassword.length < 6) {
    return res.status(400).json({ error: "Password too short" });
  }

  if (useMemoryStorage) {
    const st = memoryStudents.find((s) => s.id === studentId);
    if (!st) return res.status(404).json({ error: "Student not found" });
    if (updateName) st.name = name;
    if (updatePassword) {
      st.passwordHash = hashPassword(newPassword);
      st.mustChangePassword = false;
      st.initialPassword = null;
    }
    return res.json({
      ok: true,
      student: { id: st.id, name: st.name, email: st.email, class_id: st.classId, coins: st.coins },
    });
  }

  try {
    const col = await getStudentsCol();
    const update: Record<string, unknown> = {};
    if (updateName) update.name = name;
    if (updatePassword) {
      update.passwordHash = hashPassword(newPassword);
      update.mustChangePassword = false;
      update.initialPassword = null;
    }
    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(studentId) },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Student not found" });
    return res.json({
      ok: true,
      student: {
        id: updated._id?.toString(),
        name: updated.name,
        email: updated.email,
        class_id: updated.classId.toString(),
        coins: updated.coins,
      },
    });
  } catch (e) {
    console.error("PATCH /api/student/profile error:", e);
    return res.status(500).json({ error: "Failed to update profile" });
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
    a.reviewedAt = null;
    a.reviewComment = null;
    a.awardedCoins = null;
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
          reviewedAt: null,
          reviewComment: null,
          awardedCoins: null,
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
      reviewedAt: null,
      reviewComment: null,
      awardedCoins: null,
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
      reviewedAt: null,
      reviewComment: null,
      awardedCoins: null,
    };
    const result = await col.insertOne(doc);
    return res.json({ id: result.insertedId.toString(), ...doc });
  } catch (e) {
    console.error("POST /api/assignments error:", e);
    return res.status(500).json({ error: "Failed to create assignment" });
  }
});

app.post("/api/assignments/class", requireAdmin, async (req, res) => {
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

  if (!classId) return res.status(400).json({ error: "classId required" });
  if (!title) return res.status(400).json({ error: "title required" });
  if (!text && !imageDataUrl && !link) return res.status(400).json({ error: "text/image/link required" });

  const createdAt = new Date().toISOString();
  if (useMemoryStorage) {
    const classStudents = memoryStudents.filter((s) => s.classId === classId);
    if (classStudents.length === 0) return res.status(404).json({ error: "No students in class" });
    const inserted = classStudents.map((s) => {
      const assignment = {
        id: new ObjectId().toString(),
        studentId: s.id,
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
        reviewedAt: null,
        reviewComment: null,
        awardedCoins: null,
      };
      memoryAssignments.push(assignment);
      return assignment.id;
    });
    return res.json({ ok: true, count: inserted.length, ids: inserted });
  }

  try {
    const studentsCol = await getStudentsCol();
    const classStudents = await studentsCol.find({ classId: new ObjectId(classId) }).project({ _id: 1 }).toArray();
    if (classStudents.length === 0) return res.status(404).json({ error: "No students in class" });
    const docs = classStudents.map((s) => ({
      studentId: s._id!.toString(),
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
      reviewedAt: null,
      reviewComment: null,
      awardedCoins: null,
    }));
    const col = await getAssignmentsCol();
    const result = await col.insertMany(docs);
    return res.json({ ok: true, count: result.insertedCount });
  } catch (e) {
    console.error("POST /api/assignments/class error:", e);
    return res.status(500).json({ error: "Failed to create class assignments" });
  }
});

app.get("/api/admin/assignments", requireAdmin, async (_req, res) => {
  if (useMemoryStorage) {
    const list = memoryAssignments
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a) => {
        const st = memoryStudents.find((s) => s.id === a.studentId);
        const cls = memoryClasses.find((c) => c.id === a.classId);
        return {
          ...a,
          studentName: st?.name ?? "Unknown",
          className: cls?.name ?? "Unknown",
        };
      });
    return res.json(list);
  }

  try {
    const col = await getAssignmentsCol();
    const studentsCol = await getStudentsCol();
    const classesCol = await getClassesCol();
    const list = await col.find({}).sort({ createdAt: -1 }).toArray();
    const out = [];
    for (const a of list) {
      const st = await studentsCol.findOne({ _id: new ObjectId(a.studentId) });
      const cls = await classesCol.findOne({ _id: new ObjectId(a.classId) });
      out.push({
        id: a._id?.toString(),
        ...a,
        studentName: st?.name ?? "Unknown",
        className: cls?.name ?? "Unknown",
      });
    }
    return res.json(out);
  } catch (e) {
    console.error("GET /api/admin/assignments error:", e);
    return res.status(500).json({ error: "Failed to get assignments" });
  }
});

app.patch("/api/admin/assignments/:id/review", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const reviewComment = typeof req.body?.reviewComment === "string" ? req.body.reviewComment.trim() : "";
  const awardedCoins = coerceNonNegativeInt(req.body?.awardedCoins);
  const reviewedAt = new Date().toISOString();
  const HOMEWORK_REWARD_MAX = 10;
  if (awardedCoins > HOMEWORK_REWARD_MAX) {
    return res.status(400).json({ error: `Uy vazifasi mukofoti: maksimal ${HOMEWORK_REWARD_MAX} coin (10 ballik shkala)` });
  }

  if (useMemoryStorage) {
    const a = memoryAssignments.find((x) => x.id === id);
    if (!a) return res.status(404).json({ error: "Assignment not found" });
    if (!a.answeredAt) return res.status(400).json({ error: "Assignment has no answer yet" });
    if (a.reviewedAt) return res.status(400).json({ error: "Assignment already reviewed" });
    a.reviewedAt = reviewedAt;
    a.reviewComment = reviewComment || null;
    a.awardedCoins = awardedCoins;
    if (awardedCoins > 0) {
      const student = memoryStudents.find((s) => s.id === a.studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });
      student.coins += awardedCoins;
      memoryCoinTransactions.push({
        id: new ObjectId().toString(),
        studentId: student.id,
        classId: student.classId,
        amount: awardedCoins,
        type: "assignment_reward",
        note: `Assignment reward: ${a.title}`,
        createdAt: reviewedAt,
      });
      ensureMemoryAutoResetTracking(student.classId, reviewedAt);
      applyWeeklyActivityBonusMemory(student.id, student.classId);
    }
    return res.json({ ok: true, assignment: a });
  }

  try {
    const col = await getAssignmentsCol();
    const existing = await col.findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ error: "Assignment not found" });
    if (!existing.answeredAt) return res.status(400).json({ error: "Assignment has no answer yet" });
    if (existing.reviewedAt) return res.status(400).json({ error: "Assignment already reviewed" });

    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { reviewedAt, reviewComment: reviewComment || null, awardedCoins } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Assignment not found" });
    if (awardedCoins > 0) {
      const studentsCol = await getStudentsCol();
      const student = await studentsCol.findOneAndUpdate(
        { _id: new ObjectId(updated.studentId) },
        { $inc: { coins: awardedCoins } },
        { returnDocument: "after" }
      );
      if (!student) return res.status(404).json({ error: "Student not found" });
      const txCol = await getCoinTransactionsCol();
      await txCol.insertOne({
        studentId: updated.studentId,
        classId: updated.classId,
        amount: awardedCoins,
        type: "assignment_reward",
        note: `Assignment reward: ${updated.title}`,
        createdAt: reviewedAt,
      });
      await ensureMongoAutoResetTracking(student.classId.toString(), reviewedAt);
      await applyWeeklyActivityBonusMongo(updated.studentId, String(updated.classId));
    }
    return res.json({ ok: true, assignment: { id: updated._id?.toString(), ...updated } });
  } catch (e) {
    console.error("PATCH /api/admin/assignments/:id/review error:", e);
    return res.status(500).json({ error: "Failed to review assignment" });
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

app.get("/api/analytics", requireAdmin, async (_req, res) => {
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

app.get("/api/analytics/overview", requireAdmin, async (_req, res) => {
  if (useMemoryStorage) {
    return res.json({
      classesCount: memoryClasses.length,
      studentsCount: memoryStudents.length,
      activeCoins: memoryStudents.reduce((sum, student) => sum + student.coins, 0),
    });
  }

  try {
    const [classesCol, studentsCol] = await Promise.all([getClassesCol(), getStudentsCol()]);
    const [classesCount, studentsList] = await Promise.all([classesCol.countDocuments(), studentsCol.find({}).project({ coins: 1 }).toArray()]);
    return res.json({
      classesCount,
      studentsCount: studentsList.length,
      activeCoins: studentsList.reduce((sum, student) => sum + student.coins, 0),
    });
  } catch (e) {
    console.error("GET /api/analytics/overview error:", e);
    return res.status(500).json({ error: "Failed to get analytics overview" });
  }
});

app.get("/api/coin-stats", requireAdmin, async (req, res) => {
  const rawMode = typeof req.query.mode === "string" ? req.query.mode : "day";
  const mode: "day" | "month" | "custom" =
    rawMode === "month" || rawMode === "custom" ? rawMode : "day";
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
  const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;
  const hasCustomRange = mode === "custom" && from && to;
  const fromBoundary = hasCustomRange ? new Date(`${from}T00:00:00.000Z`) : null;
  const toBoundary = hasCustomRange ? new Date(`${to}T23:59:59.999Z`) : null;

  if (mode === "custom") {
    if (!from || !to || !fromBoundary || !toBoundary || Number.isNaN(fromBoundary.getTime()) || Number.isNaN(toBoundary.getTime()) || fromBoundary > toBoundary) {
      return res.status(400).json({ error: "Valid from and to are required for custom mode" });
    }
  }

  const filterTx = (tx: { type: string; createdAt: string }) => {
    if (tx.type === "reset") return false;
    if (!hasCustomRange || !fromBoundary || !toBoundary) return true;
    const createdAt = new Date(tx.createdAt);
    return createdAt >= fromBoundary && createdAt <= toBoundary;
  };

  if (useMemoryStorage) {
    const transactions = memoryCoinTransactions
      .filter(filterTx)
      .map((tx) => ({
        studentId: tx.studentId,
        classId: tx.classId,
        amount: tx.amount,
        createdAt: tx.createdAt,
      }));
    return res.json(
      buildCoinStatsResponse({
        mode,
        from,
        to,
        transactions,
        students: memoryStudents.map((student) => ({ id: student.id, name: student.name, classId: student.classId })),
        classes: memoryClasses.map((cls) => ({ id: cls.id, name: cls.name })),
      })
    );
  }

  try {
    const txCol = await getCoinTransactionsCol();
    const query: Record<string, unknown> = { type: { $ne: "reset" } };
    if (hasCustomRange && fromBoundary && toBoundary) {
      query.createdAt = { $gte: fromBoundary.toISOString(), $lte: toBoundary.toISOString() };
    }

    const [transactions, students, classes] = await Promise.all([
      txCol.find(query).toArray(),
      getStudentsCol().then((col) => col.find({}).toArray()),
      getClassesCol().then((col) => col.find({}).toArray()),
    ]);

    return res.json(
      buildCoinStatsResponse({
        mode,
        from,
        to,
        transactions: transactions.map((tx) => ({
          studentId: tx.studentId,
          classId: tx.classId,
          amount: tx.amount,
          createdAt: tx.createdAt,
        })),
        students: students.map((student) => ({
          id: student._id!.toString(),
          name: student.name,
          classId: student.classId.toString(),
        })),
        classes: classes.map((cls) => ({ id: cls._id!.toString(), name: cls.name })),
      })
    );
  } catch (e) {
    console.error("GET /api/coin-stats error:", e);
    return res.status(500).json({ error: "Failed to get coin stats" });
  }
});

app.get("/api/admin/schedule-slots", requireAdmin, async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
  if (!classId) return res.status(400).json({ error: "classId required" });
  if (useMemoryStorage) {
    const slots = memoryScheduleSlots
      .filter((s) => s.classId === classId)
      .slice()
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    return res.json(slots);
  }
  try {
    const col = await getScheduleSlotsCol();
    const list = await col.find({ classId }).sort({ weekday: 1, startTime: 1 }).toArray();
    return res.json(
      list.map((s) => ({
        id: s._id?.toString(),
        classId: s.classId,
        weekday: s.weekday,
        title: s.title || "",
        startTime: s.startTime,
        endTime: s.endTime,
      }))
    );
  } catch (e) {
    console.error("GET /api/admin/schedule-slots error:", e);
    return res.status(500).json({ error: "Failed to list schedule" });
  }
});

app.get("/api/admin/schedule-week", requireAdmin, async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart.trim() : "";
  if (!classId) return res.status(400).json({ error: "classId required" });
  const monday = utcMondayFromWeekStartParam(weekStart || undefined);
  if (useMemoryStorage) {
    const slots = memoryScheduleSlots.filter((s) => s.classId === classId);
    const dayLabels = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addUtcDays(monday, i);
      const w = mondayBasedWeekdayFromUtcDate(d);
      days.push({
        date: formatUtcYmd(d),
        weekday: w,
        label: dayLabels[w] ?? String(w),
        slots: slots.filter((s) => s.weekday === w).sort((a, b) => a.startTime.localeCompare(b.startTime)),
      });
    }
    return res.json({ weekStart: formatUtcYmd(monday), days });
  }
  try {
    const col = await getScheduleSlotsCol();
    const list = await col.find({ classId }).toArray();
    const slots = list.map((s) => ({
      id: s._id?.toString(),
      classId: s.classId,
      weekday: s.weekday,
      title: s.title || "",
      startTime: s.startTime,
      endTime: s.endTime,
    }));
    const dayLabels = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addUtcDays(monday, i);
      const w = mondayBasedWeekdayFromUtcDate(d);
      days.push({
        date: formatUtcYmd(d),
        weekday: w,
        label: dayLabels[w] ?? String(w),
        slots: slots.filter((s) => s.weekday === w).sort((a, b) => a.startTime.localeCompare(b.startTime)),
      });
    }
    return res.json({ weekStart: formatUtcYmd(monday), days });
  } catch (e) {
    console.error("GET /api/admin/schedule-week error:", e);
    return res.status(500).json({ error: "Failed to load week schedule" });
  }
});

app.post("/api/admin/schedule-slots", requireAdmin, async (req, res) => {
  const classId = String(req.body?.classId ?? "").trim();
  const weekday = Number(req.body?.weekday);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const startTime = String(req.body?.startTime ?? "").trim();
  const endTime = String(req.body?.endTime ?? "").trim();
  if (!classId) return res.status(400).json({ error: "classId required" });
  if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) return res.status(400).json({ error: "weekday 0-6 required" });
  if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
    return res.status(400).json({ error: "startTime and endTime as HH:mm required" });
  }
  if (useMemoryStorage) {
    const id = new ObjectId().toString();
    const slot = { id, classId, weekday, title, startTime, endTime };
    memoryScheduleSlots.push(slot);
    return res.json(slot);
  }
  try {
    const col = await getScheduleSlotsCol();
    const result = await col.insertOne({ classId, weekday, title, startTime, endTime });
    return res.json({
      id: result.insertedId.toString(),
      classId,
      weekday,
      title,
      startTime,
      endTime,
    });
  } catch (e) {
    console.error("POST /api/admin/schedule-slots error:", e);
    return res.status(500).json({ error: "Failed to add slot" });
  }
});

app.delete("/api/admin/schedule-slots/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (useMemoryStorage) {
    const idx = memoryScheduleSlots.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    memoryScheduleSlots.splice(idx, 1);
    return res.json({ success: true });
  }
  try {
    const col = await getScheduleSlotsCol();
    const r = await col.deleteOne({ _id: new ObjectId(id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/admin/schedule-slots error:", e);
    return res.status(500).json({ error: "Failed to delete slot" });
  }
});

app.get("/api/admin/attendance", requireAdmin, async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  const scheduleSlotId = typeof req.query.scheduleSlotId === "string" ? req.query.scheduleSlotId.trim() : "";
  if (!classId || !date || !scheduleSlotId) {
    return res.status(400).json({ error: "classId, date, scheduleSlotId required" });
  }
  if (useMemoryStorage) {
    const students = memoryStudents
      .filter((s) => s.classId === classId)
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const attendance: Record<string, boolean> = {};
    for (const row of memoryLessonAttendance) {
      if (row.classId === classId && row.date === date && row.scheduleSlotId === scheduleSlotId) {
        attendance[row.studentId] = row.present;
      }
    }
    return res.json({ students, attendance });
  }
  try {
    const studentsCol = await getStudentsCol();
    const list = await studentsCol.find({ classId: new ObjectId(classId) }).sort({ name: 1 }).toArray();
    const students = list.map((s) => ({ id: s._id!.toString(), name: s.name }));
    const attCol = await getLessonAttendanceCol();
    const rows = await attCol.find({ classId, date, scheduleSlotId }).toArray();
    const attendance: Record<string, boolean> = {};
    for (const row of rows) {
      attendance[row.studentId] = row.present;
    }
    return res.json({ students, attendance });
  } catch (e) {
    console.error("GET /api/admin/attendance error:", e);
    return res.status(500).json({ error: "Failed to load attendance" });
  }
});

app.put("/api/admin/attendance", requireAdmin, async (req, res) => {
  const classId = String(req.body?.classId ?? "").trim();
  const date = String(req.body?.date ?? "").trim();
  const scheduleSlotId = String(req.body?.scheduleSlotId ?? "").trim();
  const attendance = req.body?.attendance;
  if (!classId || !date || !scheduleSlotId) {
    return res.status(400).json({ error: "classId, date, scheduleSlotId required" });
  }
  if (!attendance || typeof attendance !== "object") {
    return res.status(400).json({ error: "attendance object required" });
  }
  const updatedAt = new Date().toISOString();
  if (useMemoryStorage) {
    for (let i = memoryLessonAttendance.length - 1; i >= 0; i--) {
      const r = memoryLessonAttendance[i];
      if (r.classId === classId && r.date === date && r.scheduleSlotId === scheduleSlotId) {
        memoryLessonAttendance.splice(i, 1);
      }
    }
    for (const [studentId, present] of Object.entries(attendance as Record<string, unknown>)) {
      if (typeof present !== "boolean") continue;
      memoryLessonAttendance.push({
        id: new ObjectId().toString(),
        classId,
        date,
        scheduleSlotId,
        studentId,
        present,
        updatedAt,
      });
    }
    return res.json({ ok: true });
  }
  try {
    const attCol = await getLessonAttendanceCol();
    await attCol.deleteMany({ classId, date, scheduleSlotId });
    const docs = Object.entries(attendance as Record<string, unknown>)
      .filter(([, v]) => typeof v === "boolean")
      .map(([studentId, present]) => ({
        classId,
        date,
        scheduleSlotId,
        studentId,
        present: present as boolean,
        updatedAt,
      }));
    if (docs.length) await attCol.insertMany(docs);
    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/admin/attendance error:", e);
    return res.status(500).json({ error: "Failed to save attendance" });
  }
});

app.get("/api/admin/reports/daily", requireAdmin, async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  if (!classId || !date) return res.status(400).json({ error: "classId and date required" });

  const sumCoinsForStudentOnDay = (studentId: string): number => {
    if (useMemoryStorage) {
      return memoryCoinTransactions
        .filter((t) => t.studentId === studentId && t.classId === classId && t.type !== "reset" && getDayKey(t.createdAt) === date)
        .reduce((s, t) => s + t.amount, 0);
    }
    return 0;
  };

  if (useMemoryStorage) {
    const d = new Date(`${date}T12:00:00.000Z`);
    const w = mondayBasedWeekdayFromUtcDate(d);
    const slots = memoryScheduleSlots.filter((s) => s.classId === classId && s.weekday === w).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const students = memoryStudents
      .filter((s) => s.classId === classId)
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rows = students.map((st) => {
      const slotPresence = slots.map((slot) => {
        const row = memoryLessonAttendance.find(
          (a) => a.classId === classId && a.date === date && a.scheduleSlotId === slot.id && a.studentId === st.id
        );
        return {
          scheduleSlotId: slot.id,
          title: slot.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          present: row ? row.present : null,
        };
      });
      return {
        studentId: st.id,
        studentName: st.name,
        coinsDay: sumCoinsForStudentOnDay(st.id),
        slots: slotPresence,
      };
    });
    return res.json({ date, classId, slots, rows });
  }

  try {
    const d = new Date(`${date}T12:00:00.000Z`);
    const w = mondayBasedWeekdayFromUtcDate(d);
    const slotsCol = await getScheduleSlotsCol();
    const slotDocs = await slotsCol.find({ classId, weekday: w }).sort({ startTime: 1 }).toArray();
    const slots = slotDocs.map((s) => ({
      id: s._id!.toString(),
      classId: s.classId,
      weekday: s.weekday,
      title: s.title || "",
      startTime: s.startTime,
      endTime: s.endTime,
    }));
    const studentsCol = await getStudentsCol();
    const stList = await studentsCol.find({ classId: new ObjectId(classId) }).sort({ name: 1 }).toArray();
    const attCol = await getLessonAttendanceCol();
    const attRows = await attCol.find({ classId, date }).toArray();
    const attMap = new Map<string, { slotId: string; present: boolean }[]>();
    for (const a of attRows) {
      const key = a.studentId;
      if (!attMap.has(key)) attMap.set(key, []);
      attMap.get(key)!.push({ slotId: a.scheduleSlotId, present: a.present });
    }
    const txCol = await getCoinTransactionsCol();
    const txList = await txCol
      .find({
        classId,
        type: { $ne: "reset" },
        createdAt: { $gte: `${date}T00:00:00.000Z`, $lte: `${date}T23:59:59.999Z` },
      })
      .toArray();
    const coinsByStudent = new Map<string, number>();
    for (const t of txList) {
      coinsByStudent.set(t.studentId, (coinsByStudent.get(t.studentId) ?? 0) + t.amount);
    }
    const rows = stList.map((st) => {
      const sid = st._id!.toString();
      const list = attMap.get(sid) ?? [];
      const slotPresence = slots.map((slot) => {
        const found = list.find((x) => x.slotId === slot.id);
        return {
          scheduleSlotId: slot.id,
          title: slot.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          present: found ? found.present : null,
        };
      });
      return {
        studentId: sid,
        studentName: st.name,
        coinsDay: coinsByStudent.get(sid) ?? 0,
        slots: slotPresence,
      };
    });
    return res.json({ date, classId, slots, rows });
  } catch (e) {
    console.error("GET /api/admin/reports/daily error:", e);
    return res.status(500).json({ error: "Failed to build report" });
  }
});

app.get("/api/admin/reports/range", requireAdmin, async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  if (!classId || !from || !to) return res.status(400).json({ error: "classId, from, to required (YYYY-MM-DD)" });
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  if (useMemoryStorage) {
    const dates: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(formatUtcYmd(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const students = memoryStudents.filter((s) => s.classId === classId).sort((a, b) => a.name.localeCompare(b.name));
    const days = dates.map((date) => {
      const d = new Date(`${date}T12:00:00.000Z`);
      const w = mondayBasedWeekdayFromUtcDate(d);
      const slots = memoryScheduleSlots.filter((s) => s.classId === classId && s.weekday === w);
      const rows = students.map((st) => {
        const coinsDay = memoryCoinTransactions
          .filter((t) => t.studentId === st.id && t.classId === classId && t.type !== "reset" && getDayKey(t.createdAt) === date)
          .reduce((s, t) => s + t.amount, 0);
        const slotPresence = slots.map((slot) => {
          const row = memoryLessonAttendance.find(
            (a) => a.classId === classId && a.date === date && a.scheduleSlotId === slot.id && a.studentId === st.id
          );
          return { scheduleSlotId: slot.id, title: slot.title, startTime: slot.startTime, endTime: slot.endTime, present: row ? row.present : null };
        });
        return { studentId: st.id, studentName: st.name, coinsDay, slots: slotPresence };
      });
      return { date, slots, rows };
    });
    return res.json({ classId, from, to, days });
  }

  try {
    const dates: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(formatUtcYmd(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const studentsCol = await getStudentsCol();
    const stList = await studentsCol.find({ classId: new ObjectId(classId) }).sort({ name: 1 }).toArray();
    const students = stList.map((s) => ({ id: s._id!.toString(), name: s.name }));
    const slotsCol = await getScheduleSlotsCol();
    const allSlots = await slotsCol.find({ classId }).toArray();
    const slotByWeekday = new Map<number, typeof allSlots>();
    for (const s of allSlots) {
      const w = s.weekday;
      if (!slotByWeekday.has(w)) slotByWeekday.set(w, []);
      slotByWeekday.get(w)!.push(s);
    }
    const attCol = await getLessonAttendanceCol();
    const txCol = await getCoinTransactionsCol();
    const days = [];
    for (const date of dates) {
      const d = new Date(`${date}T12:00:00.000Z`);
      const w = mondayBasedWeekdayFromUtcDate(d);
      const slotDocs = (slotByWeekday.get(w) ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
      const slots = slotDocs.map((s) => ({
        id: s._id!.toString(),
        title: s.title || "",
        startTime: s.startTime,
        endTime: s.endTime,
      }));
      const attRows = await attCol.find({ classId, date }).toArray();
      const attMap = new Map<string, Map<string, boolean>>();
      for (const a of attRows) {
        if (!attMap.has(a.studentId)) attMap.set(a.studentId, new Map());
        attMap.get(a.studentId)!.set(a.scheduleSlotId, a.present);
      }
      const txList = await txCol
        .find({
          classId,
          type: { $ne: "reset" },
          createdAt: { $gte: `${date}T00:00:00.000Z`, $lte: `${date}T23:59:59.999Z` },
        })
        .toArray();
      const coinsByStudent = new Map<string, number>();
      for (const t of txList) {
        coinsByStudent.set(t.studentId, (coinsByStudent.get(t.studentId) ?? 0) + t.amount);
      }
      const rows = students.map((st) => {
        const sm = attMap.get(st.id);
        const slotPresence = slots.map((slot) => ({
          scheduleSlotId: slot.id,
          title: slot.title,
          startTime: slot.startTime,
          endTime: slot.endTime,
          present: sm?.get(slot.id) ?? null,
        }));
        return {
          studentId: st.id,
          studentName: st.name,
          coinsDay: coinsByStudent.get(st.id) ?? 0,
          slots: slotPresence,
        };
      });
      days.push({ date, slots, rows });
    }
    return res.json({ classId, from, to, days });
  } catch (e) {
    console.error("GET /api/admin/reports/range error:", e);
    return res.status(500).json({ error: "Failed to build range report" });
  }
});

app.post("/api/classes/:classId/reset-coins", requireAdmin, async (req, res) => {
  const classId = req.params.classId;

  if (useMemoryStorage) {
    const cls = memoryClasses.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: "Class not found" });
    const classStudents = memoryStudents.filter((s) => s.classId === classId);
    const ranked: RankRow[] = classStudents.map((s) => ({ id: s.id, name: s.name, coins: s.coins }));
    const studentsBefore = ranked.map((r) => ({ name: r.name, coins: r.coins }));
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
    grantMonthlyRankBonusesMemory(classId, ranked, resetAt);
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
    const ranked: RankRow[] = studentsList.map((s) => ({
      id: s._id!.toString(),
      name: s.name,
      coins: s.coins,
    }));
    const studentsBefore = ranked.map((r) => ({ name: r.name, coins: r.coins }));

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

    await grantMonthlyRankBonusesMongo(classId, ranked, resetAt);

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

app.patch("/api/classes/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name } = req.body || {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name required" });
  const trimmed = name.trim();
  if (!trimmed) return res.status(400).json({ error: "Name required" });

  if (useMemoryStorage) {
    const existing = memoryClasses.find((c) => c.id === id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    existing.name = trimmed;
    return res.json({ id: existing.id, name: existing.name });
  }

  try {
    const oid = new ObjectId(id);
    const classesCol = await getClassesCol();
    const updated = await classesCol.findOneAndUpdate(
      { _id: oid },
      { $set: { name: trimmed } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json({ id: updated._id!.toString(), name: updated.name });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update class" });
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
    return res.json(createMemoryStudent(cidStr, trimmedName));
  }
  try {
    const cid = new ObjectId(classId);
    const classesCol = await getClassesCol();
    const exists = await classesCol.findOne({ _id: cid });
    if (!exists) return res.status(400).json({ error: "Invalid classId" });
    res.json(await createMongoStudent(classId, trimmedName));
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
      ensureMemoryAutoResetTracking(s.classId, new Date().toISOString());
      applyWeeklyActivityBonusMemory(s.id, s.classId);
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
      await ensureMongoAutoResetTracking(updated.classId.toString(), new Date().toISOString());
      await applyWeeklyActivityBonusMongo(updated._id!.toString(), updated.classId.toString());
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
        const ranked: RankRow[] = classStudents.map((s) => ({ id: s.id, name: s.name, coins: s.coins }));
        const studentsBefore = ranked.map((r) => ({ name: r.name, coins: r.coins }));
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
        grantMonthlyRankBonusesMemory(ar.classId, ranked, resetAt);
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
        const ranked: RankRow[] = studentsList.map((s) => ({
          id: s._id!.toString(),
          name: s.name,
          coins: s.coins,
        }));
        const studentsBefore = ranked.map((r) => ({ name: r.name, coins: r.coins }));

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
        await grantMonthlyRankBonusesMongo(tracking.classId, ranked, resetAt);
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
