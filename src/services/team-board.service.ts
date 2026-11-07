/**
 * مرجعُ الفريق وطلباتُه في «TPH Team».
 *
 *   المرجع: صاحبُ المقهى يكتب النظافةَ والطحنات والوصفات والبنَّ الحالي والإعلانات، والموظّفُ يقرؤها.
 *           لا «تم» ولا متابعة — مرجعٌ للوقت الحالي.
 *   الطلبات: الموظّفُ يقترح تعديلَ بطاقة، أو يطلب إجازة، أو تبديلَ راحةٍ أو وردية مع زميل، أو يبلّغ
 *           عن تالف — ولا يُنفَّذ شيءٌ منها إلّا بإقرار صاحب المقهى (`decideRequest`).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, products, teamBoard, teamRequests, type TeamBoardKind, type TeamRequestKind, type TeamRequestStatus } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { pgErrorCode } from "@/lib/pg-error";
import { addDays, daysBetween, todayInRiyadh } from "@/lib/riyadh-time";
import { isStoredUnit } from "@/lib/unit-conversion";
import type { WasteReason } from "@/lib/inventory/waste-board";
import { recordWaste } from "./inventory-movement.service";
import { loadEmployee, PayrollRefused, setAttendance, setDayShift } from "./payroll.service";
import { shiftOn } from "@/lib/payroll/attendance";
import type { Conn } from "./types";

export const BOARD_KINDS: readonly TeamBoardKind[] = ["ANNOUNCEMENT", "BEAN", "RECIPE", "GRIND", "CLEANING_DAILY", "CLEANING_WEEKLY"];

export const BOARD_LABEL: Record<TeamBoardKind, string> = {
  ANNOUNCEMENT: "إعلان",
  BEAN: "البن الحالي",
  RECIPE: "وصفة",
  GRIND: "طحنة",
  CLEANING_DAILY: "نظافة يومية",
  CLEANING_WEEKLY: "نظافة أسبوعية",
};

export function isBoardKind(v: unknown): v is TeamBoardKind {
  return typeof v === "string" && BOARD_KINDS.some((k) => k === v);
}

export const WASTE_REASONS: readonly WasteReason[] = ["EXPIRED", "SPILLED", "FAILED_PREP", "DAMAGED", "OTHER"];

/** أطولُ إجازةٍ تُطلب مرّةً — ما فوقها يُكلَّم فيه صاحبُ المقهى. */
export const MAX_LEAVE_DAYS = 30;

export class TeamRequestRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamRequestRefused";
  }
}

/* ─────────────────────────── المرجع ─────────────────────────── */

export interface BoardItem {
  id: string;
  kind: TeamBoardKind;
  title: string;
  body: string;
  weekday: number | null;
  sort: number;
  updatedAt: Date;
}

/** المرجعُ القائم بترتيبه. الجدولُ قبل هجرته لا شيءَ فيه، لا خطأ. */
export async function loadBoard(conn: Conn = db): Promise<BoardItem[]> {
  try {
    return await conn.select({
      id: teamBoard.id, kind: teamBoard.kind, title: teamBoard.title, body: teamBoard.body,
      weekday: teamBoard.weekday, sort: teamBoard.sort, updatedAt: teamBoard.updatedAt,
    }).from(teamBoard).where(sql`${teamBoard}.archived_at is null`).orderBy(teamBoard.kind, teamBoard.sort, teamBoard.title);
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

export interface BoardInput {
  kind: TeamBoardKind;
  title: string;
  body: string;
  weekday: number | null;
  sort: number;
}

export async function saveBoardItem(id: string | null, input: BoardInput, actorId: string): Promise<string> {
  const title = input.title.trim();
  if (title.length < 2) throw new TeamRequestRefused("اكتب العنوان (حرفان على الأقل).");
  const weekday = input.kind === "CLEANING_WEEKLY" ? input.weekday : null;
  if (input.kind === "CLEANING_WEEKLY" && weekday === null) throw new TeamRequestRefused("اختر يوم هذه النظافة الأسبوعية.");
  return db.transaction(async (t) => {
    if (id) {
      const [before] = await t.select().from(teamBoard).where(eq(teamBoard.id, id)).for("update");
      if (!before) throw new TeamRequestRefused("البطاقة غير موجودة. حدّث الصفحة.");
      await t.update(teamBoard).set({ kind: input.kind, title, body: input.body.trim(), weekday, sort: input.sort, updatedAt: new Date() }).where(eq(teamBoard.id, id));
      await recordAudit({ actorId, action: "TEAM_BOARD_SAVED", entityType: "team_board", entityId: id, before: { title: before.title, body: before.body }, after: { title, body: input.body.trim() } }, t);
      return id;
    }
    const [row] = await t.insert(teamBoard).values({ kind: input.kind, title, body: input.body.trim(), weekday, sort: input.sort, createdById: actorId }).returning({ id: teamBoard.id });
    await recordAudit({ actorId, action: "TEAM_BOARD_SAVED", entityType: "team_board", entityId: row.id, before: null, after: { kind: input.kind, title } }, t);
    return row.id;
  });
}

/** يُخرجها من المرجع ولا يحذفها — ويُعاد إليها بالتراجع. */
export async function setBoardArchived(id: string, archived: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(teamBoard).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(teamBoard.id, id), archived ? sql`${teamBoard}.archived_at is null` : sql`${teamBoard}.archived_at is not null`))
      .returning({ id: teamBoard.id, title: teamBoard.title });
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: archived ? "TEAM_BOARD_ARCHIVED" : "TEAM_BOARD_SAVED", entityType: "team_board", entityId: id, before: null, after: { title: done[0].title, archived } }, t);
    return true;
  });
}

/* ─────────────────────────── الطلبات ─────────────────────────── */

export type RequestInput =
  | { kind: "BOARD_EDIT"; boardId: string; proposedTitle: string | null; proposedBody: string; note: string | null }
  | { kind: "LEAVE"; fromDay: string; toDay: string; note: string | null }
  | { kind: "SWAP"; fromDay: string; withEmployeeId: string; note: string | null }
  | { kind: "WASTE"; productId: string; quantityMilli: number; unit: string; wasteReason: WasteReason; note: string | null };

/** يحفظ طلبَ الموظّف «ينتظر» — ويفحص ما يُفحص الآن، والباقي عند الإقرار. */
export async function createRequest(employeeId: string, input: RequestInput, today = todayInRiyadh()): Promise<string> {
  const base = { employeeId, kind: input.kind as TeamRequestKind, note: input.note?.trim() || null };
  let values: typeof teamRequests.$inferInsert;
  if (input.kind === "BOARD_EDIT") {
    const [card] = await db.select({ id: teamBoard.id }).from(teamBoard).where(and(eq(teamBoard.id, input.boardId), sql`${teamBoard}.archived_at is null`)).limit(1);
    if (!card) throw new TeamRequestRefused("هذه البطاقة لم تعد في المرجع. حدّث الصفحة.");
    const body = input.proposedBody.trim();
    if (body.length < 2) throw new TeamRequestRefused("اكتب التعديل الذي تقترحه.");
    values = { ...base, boardId: card.id, proposedTitle: input.proposedTitle?.trim() || null, proposedBody: body.slice(0, 4000) };
  } else if (input.kind === "LEAVE") {
    if (input.toDay < input.fromDay) throw new TeamRequestRefused("نهاية الإجازة قبل بدايتها.");
    if (input.fromDay < addDays(today, -7)) throw new TeamRequestRefused("لا تُطلب إجازة لأيامٍ مضى عليها أكثر من أسبوع.");
    if (daysBetween(input.fromDay, input.toDay) + 1 > MAX_LEAVE_DAYS) throw new TeamRequestRefused(`الإجازة أطول من ${MAX_LEAVE_DAYS} يوماً. كلّم الإدارة.`);
    values = { ...base, fromDay: input.fromDay, toDay: input.toDay };
  } else if (input.kind === "SWAP") {
    if (input.withEmployeeId === employeeId) throw new TeamRequestRefused("اختر زميلاً غيرك.");
    if (input.fromDay < today) throw new TeamRequestRefused("التبديل ليومٍ قادم، لا ليومٍ مضى.");
    const mate = await loadEmployee(input.withEmployeeId);
    if (!mate || (mate.leftOn && mate.leftOn < today)) throw new TeamRequestRefused("الزميل غير موجود.");
    values = { ...base, fromDay: input.fromDay, withEmployeeId: mate.id };
  } else {
    if (!isStoredUnit(input.unit)) throw new TeamRequestRefused("وحدة غير معروفة.");
    if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) throw new TeamRequestRefused("اكتب الكمية.");
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.isStockItem, true))).limit(1);
    if (!p) throw new TeamRequestRefused("الصنف غير موجود في الجرد.");
    values = { ...base, productId: p.id, quantityMilli: input.quantityMilli, unit: input.unit, wasteReason: input.wasteReason };
  }
  const [row] = await db.insert(teamRequests).values(values).returning({ id: teamRequests.id });
  return row.id;
}

/** يسحب الموظّفُ طلبَه ما دام ينتظر. */
export async function withdrawRequest(employeeId: string, id: string): Promise<boolean> {
  const done = await db.update(teamRequests).set({ status: "WITHDRAWN" })
    .where(and(eq(teamRequests.id, id), eq(teamRequests.employeeId, employeeId), eq(teamRequests.status, "PENDING"))).returning({ id: teamRequests.id });
  return done.length > 0;
}

export interface RequestView {
  id: string;
  kind: TeamRequestKind;
  status: TeamRequestStatus;
  employeeId: string;
  employeeName: string;
  boardId: string | null;
  boardTitle: string | null;
  boardBody: string | null;
  proposedTitle: string | null;
  proposedBody: string | null;
  fromDay: string | null;
  toDay: string | null;
  withEmployeeId: string | null;
  withEmployeeName: string | null;
  productName: string | null;
  quantityMilli: number | null;
  unit: string | null;
  wasteReason: string | null;
  note: string | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

async function loadRequests(where: ReturnType<typeof sql> | ReturnType<typeof eq>, limit: number, conn: Conn = db): Promise<RequestView[]> {
  try {
    const rows = await conn.select({
      id: teamRequests.id, kind: teamRequests.kind, status: teamRequests.status, employeeId: teamRequests.employeeId,
      employeeName: employees.name, boardId: teamRequests.boardId, boardTitle: teamBoard.title, boardBody: teamBoard.body,
      proposedTitle: teamRequests.proposedTitle, proposedBody: teamRequests.proposedBody, fromDay: teamRequests.fromDay, toDay: teamRequests.toDay,
      withEmployeeId: teamRequests.withEmployeeId, productName: products.nameAr, quantityMilli: teamRequests.quantityMilli, unit: teamRequests.unit,
      wasteReason: teamRequests.wasteReason, note: teamRequests.note, decisionNote: teamRequests.decisionNote, createdAt: teamRequests.createdAt, decidedAt: teamRequests.decidedAt,
    }).from(teamRequests)
      .innerJoin(employees, eq(employees.id, teamRequests.employeeId))
      .leftJoin(teamBoard, eq(teamBoard.id, teamRequests.boardId))
      .leftJoin(products, eq(products.id, teamRequests.productId))
      .where(where).orderBy(desc(teamRequests.createdAt)).limit(limit);
    const mates = [...new Set(rows.map((r) => r.withEmployeeId).filter((x): x is string => x !== null))];
    const names = mates.length === 0 ? new Map<string, string>()
      : new Map((await conn.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, mates))).map((m) => [m.id, m.name]));
    return rows.map((r) => ({ ...r, withEmployeeName: r.withEmployeeId ? names.get(r.withEmployeeId) ?? null : null }));
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

export const myRequests = (employeeId: string) => loadRequests(eq(teamRequests.employeeId, employeeId), 15);
export const pendingRequests = (conn: Conn = db) => loadRequests(eq(teamRequests.status, "PENDING"), 200, conn);
export const decidedRequests = () => loadRequests(sql`${teamRequests}.status in ('APPROVED', 'REJECTED')`, 30);

export { pendingRequestCount } from "./team-requests-count";

/**
 * يقرّ الطلبَ أو يردّه. الإقرارُ يُنفّذه بخدمات التطبيق نفسها:
 *   تعديلُ بطاقة ← تُكتب البطاقةُ بنصّه · إجازة ← «إجازة» لكلّ يومٍ فلا يُخصم منه ·
 *   تبديل ← دوامُ كلٍّ منهما يومَها يصير دوامَ الآخر · تالف ← سطرٌ في سجلّ الهدر.
 * ويُعطي النتيجةَ نفسَها إن ضُغط مرّتين: ما ليس «ينتظر» لا يُقرّ ثانية.
 */
export async function decideRequest(id: string, approve: boolean, note: string | null, actorId: string): Promise<boolean> {
  const [r] = await db.select().from(teamRequests).where(eq(teamRequests.id, id)).limit(1);
  if (!r || r.status !== "PENDING") return false;
  if (approve) {
    if (r.kind === "BOARD_EDIT") {
      const [card] = r.boardId ? await db.select().from(teamBoard).where(eq(teamBoard.id, r.boardId)).limit(1) : [];
      if (!card) throw new TeamRequestRefused("البطاقة لم تعد موجودة — ارفض الطلب.");
      await saveBoardItem(card.id, { kind: card.kind, title: r.proposedTitle ?? card.title, body: r.proposedBody ?? card.body, weekday: card.weekday, sort: card.sort }, actorId);
    } else if (r.kind === "LEAVE") {
      const days = daysBetween(r.fromDay!, r.toDay ?? r.fromDay!) + 1;
      for (let i = 0; i < days; i++) {
        await setAttendance({ employeeId: r.employeeId, day: addDays(r.fromDay!, i), kind: "LEAVE", minutes: null, note: `إجازة طلبها من TPH Team${r.note ? `: ${r.note}` : ""}` }, actorId);
      }
    } else if (r.kind === "SWAP") {
      const [a, b] = await Promise.all([loadEmployee(r.employeeId), r.withEmployeeId ? loadEmployee(r.withEmployeeId) : null]);
      if (!a || !b) throw new TeamRequestRefused("أحد الموظفَين لم يعد موجوداً — ارفض الطلب.");
      const day = r.fromDay!;
      const sa = shiftOn(day, a, a.shiftRules), sb = shiftOn(day, b, b.shiftRules);
      const why = `تبديل بين ${a.name} و${b.name}`;
      const asRule = (s: typeof sa) => (s.off || !s.start ? { off: true, shiftStart: null, shiftMinutes: null } : { off: false, shiftStart: s.start, shiftMinutes: s.minutes });
      await setDayShift(a.id, { day, ...asRule(sb), note: why }, actorId);
      await setDayShift(b.id, { day, ...asRule(sa), note: why }, actorId);
    } else if (r.kind === "WASTE") {
      const emp = await loadEmployee(r.employeeId);
      if (!isStoredUnit(r.unit)) throw new TeamRequestRefused("وحدة غير معروفة — ارفض الطلب.");
      await recordWaste({
        productId: r.productId!, quantityMilli: r.quantityMilli!, unit: r.unit, occurredOn: todayInRiyadh(r.createdAt),
        reason: (r.wasteReason ?? "OTHER") as WasteReason, note: `بلّغ عنه ${emp?.name ?? "موظف"} من TPH Team${r.note ? `: ${r.note}` : ""}`,
        clientRequestId: `team:${r.id}`, actorId,
      });
    }
  }
  return db.transaction(async (t) => {
    const done = await t.update(teamRequests).set({ status: approve ? "APPROVED" : "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: note?.trim() || null })
      .where(and(eq(teamRequests.id, id), eq(teamRequests.status, "PENDING"))).returning({ id: teamRequests.id });
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: approve ? "TEAM_REQUEST_APPROVED" : "TEAM_REQUEST_REJECTED", entityType: "team_request", entityId: id, before: { kind: r.kind }, after: { approve, note } }, t);
    return true;
  });
}

export { PayrollRefused };
