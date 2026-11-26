/**
 * إشعاراتُ كشف المورّد مقابلَ الإشعارات التي قيّدناها — الجلبُ هنا، والحكمُ لـ`matchCreditNotes`
 * (`lib/credit-notes.ts`)، والقيدُ لـ`credit-note.service.ts`.
 *
 * كان الإشعارُ يُقيَّد من الفاتورة وحدها، وكشفُ المورّد يذكره ولا يقابله شيء: فلا يُعرف أيُّ إشعارٍ في
 * كشفه مسجَّلٌ عندنا، ولا أيُّ إشعارٍ قيّدناه لم يقيّده هو. فصار يُقابَل بالرقم ثمّ بالمبلغ بالهللة،
 * والالتباسُ اقتراحٌ لا مطابقة، و«دائنٌ في الكشف بلا إشعار مسجَّل» يُقيَّد من سطره بضغطة.
 *
 * والمقابلةُ قراءةٌ لا تكتب: لا عمودَ يحفظ زوجاً، فلا زوجَ يُفكّ. ما يُكتب هو الإشعارُ نفسُه، دفعةً
 * `CREDIT_NOTE` بآلة الإشعار كلِّها (حدودُ التخصيص، قفلُ الشهر، التدقيق)، ويُفكّ بردّ الدفعة —
 * فيعود سطرُه «بلا إشعار مسجَّل» في القراءة التالية.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  classifyCredit, creditNoteReferenceOf, matchCreditNotes, normalizeCreditRef, reversedInvoiceOf,
  type CreditNoteReconciliation, type RecordedCreditNote, type StatementCreditNoteLine,
} from "@/lib/credit-notes";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay, isoDay } from "@/lib/riyadh-time";
import { CreditNoteRefused, recordAccountCreditNote, recordCreditNote } from "./credit-note.service";
import { refreshStatementFindings } from "./statement-reconcile.service";
import type { Conn, Tx } from "./types";

type RawCreditLine = { ref: string | null; description: string | null };

const isCreditNoteLine = (l: { day: string; ref: string | null; description: string | null; amountMinor: number }) =>
  classifyCredit({ id: "", date: new Date(`${l.day}T00:00:00Z`), amountMinor: l.amountMinor, description: l.description, reference: l.ref }) === "CREDIT_NOTE";

/**
 * أرقامُ فواتيرنا التي تعكسها إشعاراتُ الكشف — لكلّ مورّد، موحَّدةً بـ`normalizeCreditRef`.
 * بأرقام ما يُعكس وحده لا بكلّ فواتير المورّدين: «يحتاج قرارك» يجري مع كلّ صفحة. وتُجلب بآخر
 * خاناتها وتُوحَّد هنا بالقاعدة نفسها — لا توحيدٌ ثانٍ في SQL قد يخالفها.
 */
export async function knownReversedInvoices(
  conn: Conn,
  supplierIds: readonly string[],
  lines: readonly RawCreditLine[],
): Promise<Map<string, Set<string>>> {
  const known = new Map<string, Set<string>>();
  const targets = [...new Set(lines.flatMap((c) => {
    const t = reversedInvoiceOf(c);
    return t ? [normalizeCreditRef(t)] : [];
  }))];
  if (targets.length === 0 || supplierIds.length === 0) return known;
  const tails = [...new Set(targets.map((t) => t.match(/\d+(?!.*\d)/)?.[0] ?? t))];
  const rows = (await conn.execute<{ supplier_id: string; num: string }>(sql`
    select i.supplier_id, i.invoice_number as num
      from invoices i join documents d on d.id = i.document_id
     where d.status <> 'REJECTED'
       and i.supplier_id in (${sql.join(supplierIds.map((id) => sql`${id}`), sql`, `)})
       and (${sql.join(tails.map((t) => sql`i.invoice_number like ${`%${t}%`}`), sql` or `)})
  `)).rows;
  for (const r of rows) known.set(r.supplier_id, (known.get(r.supplier_id) ?? new Set()).add(normalizeCreditRef(r.num)));
  return known;
}

/** الإشعاراتُ التي قيّدناها لمورّدين — المردودُ والملغى لم يبقَ لهما أثر. */
async function recordedCreditNotes(conn: Conn, supplierIds: readonly string[]): Promise<Map<string, RecordedCreditNote[]>> {
  const by = new Map<string, RecordedCreditNote[]>();
  if (supplierIds.length === 0) return by;
  const rows = (await conn.execute<{ id: string; supplier_id: string; d: string; amount: number; label: string | null }>(sql`
    select p.id, p.supplier_id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as d,
           p.amount_minor as amount, p.beneficiary_name_raw as label
      from payments p
     where p.method = 'CREDIT_NOTE' and p.status not in ('REVERSED', 'VOID')
       and p.supplier_id in (${sql.join(supplierIds.map((id) => sql`${id}`), sql`, `)})
  `)).rows;
  for (const r of rows) {
    by.set(r.supplier_id, [...(by.get(r.supplier_id) ?? []), {
      paymentId: r.id, day: r.d, amountMinor: Number(r.amount), reference: creditNoteReferenceOf(r.label),
    }]);
  }
  return by;
}

export interface StatementCredits {
  statementId: string;
  supplierId: string;
  periodFrom: string;
  periodTo: string;
  result: CreditNoteReconciliation;
}

/**
 * الحكمُ الواحد بعد الجلب — للكشف المحفوظ وللفحص الذي لم يُحفظ. كشفٌ لا دائنَ فيه أصلاً
 * (فواتيرُ وحدها) لا يُسأل عن إشعاراتنا: غيابُها منه صفةُ الكشف (`compareSettlements` بالقاعدة نفسها).
 */
function judge(
  credits: readonly StatementCreditNoteLine[],
  notes: readonly RecordedCreditNote[],
  period: { from: string; to: string },
  known: ReadonlySet<string>,
): CreditNoteReconciliation {
  const result = matchCreditNotes(credits.filter(isCreditNoteLine), notes, period, { knownInvoices: known });
  return credits.length > 0 ? result : { ...result, notInStatement: [] };
}

/** إشعاراتُ كشوفٍ محفوظة مقابلَ ما قيّدناه — وأسطرُها بمعرّفاتها، فيُقيَّد الإشعارُ من سطره. */
export async function loadStatementCredits(
  statementIds: readonly string[] | null = null,
  conn: Conn = db,
): Promise<Map<string, StatementCredits>> {
  const out = new Map<string, StatementCredits>();
  if (statementIds !== null && statementIds.length === 0) return out;
  const scope = statementIds === null ? sql`true` : sql`st.id in (${sql.join(statementIds.map((id) => sql`${id}`), sql`, `)})`;
  const sts = (await conn.execute<{ id: string; supplier_id: string; ps: string; pe: string }>(sql`
    select st.id, st.supplier_id, st.period_start::date::text as ps, st.period_end::date::text as pe
      from statements st
     where st.supplier_id is not null and st.period_start is not null and st.period_end is not null and ${scope}
  `)).rows;
  if (sts.length === 0) return out;
  const lines = (await conn.execute<{ id: string; statement_id: string; d: string; ref: string | null; description: string | null; credit: number }>(sql`
    select sl.id, sl.statement_id, (sl.date at time zone 'UTC')::date::text as d, sl.ref, sl.description, sl.credit_minor as credit
      from statement_lines sl
     where sl.credit_minor > 0 and sl.statement_id in (${sql.join(sts.map((s) => sql`${s.id}`), sql`, `)})
  `)).rows;
  const supplierIds = [...new Set(sts.map((s) => s.supplier_id))];
  const [notes, known] = await Promise.all([
    recordedCreditNotes(conn, supplierIds),
    knownReversedInvoices(conn, supplierIds, lines),
  ]);
  for (const s of sts) {
    const credits = lines.filter((l) => l.statement_id === s.id)
      .map((l) => ({ id: l.id, day: l.d, ref: l.ref, description: l.description, amountMinor: Number(l.credit) }));
    out.set(s.id, {
      statementId: s.id, supplierId: s.supplier_id, periodFrom: s.ps, periodTo: s.pe,
      result: judge(credits, notes.get(s.supplier_id) ?? [], { from: s.ps, to: s.pe }, known.get(s.supplier_id) ?? new Set()),
    });
  }
  return out;
}

/** فحصُ كشفٍ لم يُحفظ — أسطرُه بلا معرّفات، فيُعرض ولا يُقيَّد منه شيء. */
export async function creditsForLines(
  conn: Conn,
  supplierId: string,
  lines: readonly { date: Date; ref?: string | null; description?: string | null; creditMinor: number }[],
  period: { from: string; to: string },
): Promise<CreditNoteReconciliation> {
  const credits = lines.filter((l) => l.creditMinor > 0)
    .map((l) => ({ day: isoDay(l.date), ref: l.ref ?? null, description: l.description ?? null, amountMinor: l.creditMinor }));
  const [notes, known] = await Promise.all([
    recordedCreditNotes(conn, [supplierId]),
    knownReversedInvoices(conn, [supplierId], credits),
  ]);
  return judge(credits, notes.get(supplierId) ?? [], period, known.get(supplierId) ?? new Set());
}

/**
 * «سجّله إشعاراً» من سطر الكشف — الطلبُ معرّفُ السطر وحده، والخادمُ يقرأ مبلغه وتاريخه ومرجعه.
 *
 * ويعيد المقابلةَ قبل أن يكتب: سطرٌ يقابله إشعارٌ مسجَّل يُرفض (ضغطتان لا تُقيّدانه مرّتين — قفلُ
 * الكشف يرتّبهما)، وسطرٌ يعكس فاتورةً ليست عندنا يُرفض بسببه، وسطرٌ له مرشّحٌ ملتبس يُسأل ويمضي بإقرار.
 * والإشعارُ الذي يعكس فاتورةً عندنا يُقيَّد عليها ما دام لا يتجاوز ما بقي منها، وإلّا على حساب المورّد
 * (بالأقدم أوّلاً، وما بقي رصيدٌ لك عنده).
 */
export async function recordCreditFromStatementLine(
  tx: Tx,
  input: { statementLineId: string; acknowledgeDuplicate?: boolean },
  actorId: string,
): Promise<{ paymentId: string; invoiceNumber: string | null; message: string }> {
  const [row] = (await tx.execute<{
    id: string; statement_id: string; supplier_id: string | null; d: string; ref: string | null; description: string | null;
    credit: number; ps: string | null; pe: string | null;
  }>(sql`
    select sl.id, sl.statement_id, st.supplier_id, (sl.date at time zone 'UTC')::date::text as d, sl.ref, sl.description,
           sl.credit_minor as credit, st.period_start::date::text as ps, st.period_end::date::text as pe
      from statement_lines sl join statements st on st.id = sl.statement_id
     where sl.id = ${input.statementLineId}
       for update of st
  `)).rows;
  if (!row) throw new CreditNoteRefused("سطر الكشف لم يعد موجوداً، فربما أُعيدت مطابقة الكشف. حدّث الصفحة");
  if (!row.supplier_id || !row.ps || !row.pe) throw new CreditNoteRefused("الكشف بلا مورّد أو بلا فترة، فطابقه أولاً");
  const amountMinor = Number(row.credit);
  const line = { id: row.id, day: row.d, ref: row.ref, description: row.description, amountMinor };
  if (amountMinor <= 0) throw new CreditNoteRefused("هذا السطر ليس دائناً، فلا إشعار فيه");
  if (!isCreditNoteLine(line)) throw new CreditNoteRefused("هذا السطر سداد لا إشعار دائن، فسجّله دفعة");

  const all = await loadStatementCredits([row.statement_id], tx);
  const r = all.get(row.statement_id)!.result;
  const same = (l: StatementCreditNoteLine) => l.id === row.id;
  const hit = r.matched.find((m) => same(m.line));
  if (hit) {
    throw new CreditNoteRefused(`هذا الإشعار مسجّل: يقابله إشعار بـ${formatRiyalsDisplay(hit.note.amountMinor)} بتاريخ ${formatDay(hit.note.day)}`);
  }
  const reversal = r.reversesUnknown.find((x) => same(x.line));
  if (reversal) {
    throw new CreditNoteRefused(`هذا السطر يلغي فاتورة ${reversal.invoiceNumber} وهي ليست في سجلاتنا: المورّد سجّلها ثم ألغاها، فلا أثر لها على ما تدين له به ولا يُسجَّل إشعاراً`);
  }
  const maybe = r.suggested.find((x) => same(x.line));
  if (maybe && !input.acknowledgeDuplicate) {
    throw new CreditNoteRefused(
      `يشبه إشعاراً مسجّلاً (${maybe.candidates.map((c) => `${formatRiyalsDisplay(c.amountMinor)} بتاريخ ${formatDay(c.day)}${c.reference ? ` · ${c.reference}` : ""}`).join("، ")}). `
      + "إن كان هذا إشعاراً آخر فأكّد ذلك ثم سجّله",
      true,
    );
  }

  const origin = {
    statementId: row.statement_id,
    statementLineId: row.id,
    lineText: [row.d, row.ref, row.description, formatRiyalsDisplay(amountMinor)].filter(Boolean).join(" · "),
  };
  const reference = (row.ref ?? "").trim().slice(0, 60) || null;
  const reason = `من كشف المورّد ${formatDay(row.ps)} إلى ${formatDay(row.pe)}${row.description ? `: ${row.description}` : ""}`.slice(0, 200);

  /* إشعارٌ يعكس فاتورةً عندنا يُقيَّد عليها — ما دام لا يتجاوز ما بقي منها */
  const target = reversedInvoiceOf(line);
  let onInvoice: { id: string; number: string } | null = null;
  if (target) {
    const want = normalizeCreditRef(target);
    const tail = want.match(/\d+(?!.*\d)/)?.[0] ?? want;
    const cands = (await tx.execute<{ id: string; num: string }>(sql`
      select i.id, i.invoice_number as num
        from invoices i join documents d on d.id = i.document_id
       where i.supplier_id = ${row.supplier_id} and d.status <> 'REJECTED' and i.invoice_number like ${`%${tail}%`}
    `)).rows.filter((c) => normalizeCreditRef(c.num) === want);
    if (cands.length === 1) onInvoice = { id: cands[0].id, number: cands[0].num };
  }

  if (onInvoice) {
    /*
      `recordCreditNote` يحسب ما بقي على الفاتورة ويرفض ما يتجاوزه قبل أن يكتب شيئاً — فإن رفض
      لذلك (فاتورةٌ سُدّدت) قُيِّد على الحساب. وشبيهُ الإشعار المسجَّل لا يُتجاوَز: يُسأل.
    */
    try {
      const out = await recordCreditNote(tx, {
        invoiceId: onInvoice.id, amountMinor, issuedOn: row.d, reference, reason,
        acknowledgeDuplicate: input.acknowledgeDuplicate === true, origin,
      }, actorId);
      await refreshStatementFindings(tx, row.statement_id);
      return {
        paymentId: out.paymentId,
        invoiceNumber: onInvoice.number,
        message: `سُجّل الإشعار على فاتورة ${onInvoice.number}. ${out.remainingMinor > 0 ? `المتبقي عليها ${formatRiyalsDisplay(out.remainingMinor)}` : "صارت مسدّدة بالكامل"}`,
      };
    } catch (e) {
      if (!(e instanceof CreditNoteRefused) || e.duplicate) throw e;
    }
  }
  const acc = await recordAccountCreditNote(tx, {
    supplierId: row.supplier_id, amountMinor, issuedOn: row.d, reference, reason,
    acknowledgeDuplicate: input.acknowledgeDuplicate === true, origin,
  }, actorId);
  await refreshStatementFindings(tx, row.statement_id);
  return {
    paymentId: acc.paymentId,
    invoiceNumber: null,
    message: acc.creditLeftMinor > 0
      ? acc.appliedMinor > 0
        ? `سُجّل الإشعار: خُصم ${formatRiyalsDisplay(acc.appliedMinor)} من فواتيره المفتوحة، وبقي ${formatRiyalsDisplay(acc.creditLeftMinor)} رصيداً لك عنده`
        : `سُجّل الإشعار رصيداً لك عنده (${formatRiyalsDisplay(acc.creditLeftMinor)})، ويُخصم من فاتورته القادمة`
      : "سُجّل الإشعار، وخُصم كله من فواتيره المفتوحة",
  };
}
