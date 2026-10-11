/**
 * دفترُ الاختيارات — يجمع ما قرّره صاحبُ المقهى بيده من جداوله، بحاله اليوم.
 *
 * لا جدولَ جديد ولا قاعدةَ جديدة: كلُّ بابٍ يُقرأ من حيث يُكتب، وحكمُ «أتُحسب؟» في
 * الإقرار يأتي من `loadVatReturn` نفسِها — فما تقوله هذه الصفحة هو ما تحسبه صفحةُ
 * الإقرار حرفاً. والسحبُ يمرّ بالمسارات القائمة (`ChoiceRevoke`)، بحرّاسها.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertResolutions, bankRules, bankTransactions, invoices, issues, paymentHoldOverrides,
  suppliers, users, vatInvoiceChoices, vatPeriodInputs, vatTxChoices,
} from "@/db/schema";
import {
  summarizeChoices, vatInvoiceChoiceRows, vatTxChoiceRows, type ChoiceRow, type ChoiceSummary,
} from "@/lib/choices";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { DOUBLE_PAID_DECISION_LABEL, type DoublePaidDecision } from "@/lib/bank/double-paid";
import { groupIban } from "@/lib/bank/iban-guard";
import { snoozeDay } from "@/lib/signal-decisions";
import { DAY, TRANSACTION, countNoun } from "@/lib/arabic";
import { txHref } from "@/lib/inspector";
import { invoiceHref } from "@/lib/invoice-profile";
import { formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import {
  includedByDefault, machineEligible, periodKey, quarterLabel, quarterOfMonth, vatInsideGross, type VatQuarter,
} from "@/lib/vat-return";
import { snoozedAttention } from "@/lib/work";
import { loadPayeeAccounts } from "./payee-account.service";
import { loadVatFiling, loadVatReturn } from "./vat-return.service";

/** كم ربعاً يُعاد حسابُ إقراره هنا — ما قبلها يُعدّ ولا يُفصَّل (كلُّ ربعٍ استعلاماتُ إقرارٍ كامل). */
export const CHOICE_QUARTERS = 4;

export interface ChoiceLedger extends ChoiceSummary {
  /** اختياراتُ إقرارٍ في أرباعٍ أقدم لم تُفصَّل هنا — تُفتح من صفحة الإقرار. */
  olderVatChoices: { quarters: { key: string; label: string }[]; count: number };
}

const day = (at: Date | null | undefined): string | null => (at ? todayInRiyadh(at) : null);

function isDoubleDecision(v: string): v is DoublePaidDecision {
  return Object.hasOwn(DOUBLE_PAID_DECISION_LABEL, v);
}

async function vatChoiceRows(): Promise<{ rows: ChoiceRow[]; older: ChoiceLedger["olderVatChoices"] }> {
  const months = (await db.execute<{ month: string; n: number }>(sql`
    select month, count(*)::int as n from (
      select to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month
        from vat_tx_choices c join bank_transactions bt on bt.id = c.bank_transaction_id
      union all
      select i.period_month as month
        from vat_invoice_choices c join invoices i on i.id = c.invoice_id
    ) x group by month
  `)).rows;

  const perQuarter = new Map<string, { quarter: VatQuarter; count: number }>();
  for (const m of months) {
    const quarter = quarterOfMonth(m.month);
    const key = periodKey(quarter);
    perQuarter.set(key, { quarter, count: (perQuarter.get(key)?.count ?? 0) + Number(m.n) });
  }
  const ordered = [...perQuarter.entries()].sort(([a], [b]) => b.localeCompare(a));
  const recent = ordered.slice(0, CHOICE_QUARTERS);
  const rest = ordered.slice(CHOICE_QUARTERS);

  const [txDecided, invoiceDecided, views] = await Promise.all([
    db.select({ id: vatTxChoices.bankTransactionId, at: vatTxChoices.decidedAt }).from(vatTxChoices),
    db.select({ id: vatInvoiceChoices.invoiceId, at: vatInvoiceChoices.decidedAt }).from(vatInvoiceChoices),
    Promise.all(recent.map(async ([, q]) => ({ quarter: q.quarter, view: await loadVatReturn(q.quarter) }))),
  ]);
  const txAt = new Map(txDecided.map((r) => [r.id, r.at]));
  const invoiceAt = new Map(invoiceDecided.map((r) => [r.id, r.at]));

  const rows: ChoiceRow[] = [];
  for (const { quarter, view } of views) {
    const filed = view.filing ? `إقرارُ ${quarterLabel(quarter)}` : null;
    const period = `/close/vat?period=${periodKey(quarter)}`;
    rows.push(
      ...vatTxChoiceRows(view.txs.map((t) => ({
        id: t.id, day: t.day, label: `${t.label} — ${formatDay(t.day)}`, direction: t.direction, choice: t.choice,
        included: t.included, vatMinor: t.vatMinor, blocked: t.blocked,
        includedByDefault: includedByDefault(t),
        href: t.direction === "CREDIT" ? `${period}#credits` : `${period}#debits`,
      })), filed).map((r) => ({ ...r, decidedOn: day(txAt.get(r.id.slice("vat-tx:".length))) ?? r.decidedOn })),
      ...vatInvoiceChoiceRows(view.invoices.map((i) => ({
        id: i.id, day: i.day, supplier: i.supplier, number: i.number, choice: i.choice, included: i.included,
        vatUsedMinor: i.vatUsedMinor, vatMinor: i.vatMinor,
        machineEligible: machineEligible({ ...i, awaitingReview: i.awaitingReview }),
        href: invoiceHref(i.id, "tax"),
      })), filed).map((r) => ({ ...r, decidedOn: day(invoiceAt.get(r.id.slice("vat-invoice:".length))) ?? r.decidedOn })),
    );
  }
  return {
    rows,
    older: {
      quarters: rest.map(([key, q]) => ({ key, label: quarterLabel(q.quarter) })),
      count: rest.reduce((s, [, q]) => s + q.count, 0),
    },
  };
}

async function cashRows(): Promise<ChoiceRow[]> {
  const rows = await db.select().from(vatPeriodInputs).orderBy(desc(vatPeriodInputs.month));
  const quarters = new Map<string, VatQuarter>();
  for (const r of rows) {
    const q = quarterOfMonth(r.month);
    quarters.set(periodKey(q), q);
  }
  const filed = new Set(
    (await Promise.all([...quarters.values()].map(async (q) => ((await loadVatFiling(q)) ? periodKey(q) : null))))
      .filter((k): k is string => k !== null),
  );
  return rows.map((r): ChoiceRow => {
    const q = quarterOfMonth(r.month);
    const locked = filed.has(periodKey(q));
    return {
      id: `vat-cash:${r.month}`,
      group: "vat-cash",
      subject: formatMonth(r.month),
      choice: "نقدٌ لم يُودَع، شاملاً الضريبة",
      decidedOn: day(r.updatedAt),
      effectMinor: vatInsideGross(r.cashSalesGrossMinor),
      effectLabel: "ضريبةُ مبيعات",
      state: locked ? "LOCKED" : "APPLIED",
      reason: locked ? `إقرارُ ${quarterLabel(q)} قُدِّم` : null,
      href: `/close/vat?period=${r.month}#cash`,
      revoke: locked ? null : {
        url: "/api/vat-return", needs: "month:close",
        body: { action: "cash", month: r.month, amount: null },
        label: "امحُه — «لم يُكتب»",
      },
    };
  });
}

async function holdRows(): Promise<ChoiceRow[]> {
  const rows = await db
    .select({
      invoiceId: paymentHoldOverrides.invoiceId, note: paymentHoldOverrides.note, holdReason: paymentHoldOverrides.holdReason,
      at: paymentHoldOverrides.createdAt, number: invoices.invoiceNumber, month: invoices.periodMonth,
      totalMinor: invoices.totalMinor, supplier: suppliers.nameAr,
    })
    .from(paymentHoldOverrides)
    .innerJoin(invoices, eq(invoices.id, paymentHoldOverrides.invoiceId))
    .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .orderBy(desc(paymentHoldOverrides.createdAt));
  return rows.map((r): ChoiceRow => ({
    id: `hold:${r.invoiceId}`,
    group: "hold",
    subject: `${r.supplier} — ${r.number || "بلا رقم"}`,
    choice: `تُدفع وهي محجوزة — «${r.note}»`,
    decidedOn: day(r.at),
    effectMinor: r.totalMinor,
    effectLabel: "إجماليُّ الفاتورة — يدخل الدفعةَ ما بقي منها",
    state: "APPLIED",
    reason: null,
    href: "/payments",
    revoke: {
      url: "/api/payment-run/hold", needs: "payment:approve",
      body: { month: r.month, invoiceIds: [r.invoiceId], action: "restore" },
      label: "أعِدها إلى الحجز",
    },
  }));
}

async function alertRows(): Promise<ChoiceRow[]> {
  const rows = await db
    .select({ key: alertResolutions.key, decision: alertResolutions.decision, note: alertResolutions.note, at: alertResolutions.at })
    .from(alertResolutions)
    .orderBy(desc(alertResolutions.at));
  if (rows.length === 0) return [];

  const txIds = rows.flatMap((r) => (r.key.startsWith("double:") || r.key.startsWith("bounce:") ? r.key.split(":").slice(1) : []));
  const supplierIds = rows.flatMap((r) => (r.key.startsWith("iban:") ? [r.key.split(":")[1] ?? ""] : []));
  const [txs, sups] = await Promise.all([
    txIds.length === 0 ? [] : db
      .select({ id: bankTransactions.id, amountMinor: bankTransactions.amountMinor, valueDate: bankTransactions.valueDate, beneficiary: bankTransactions.beneficiaryRaw })
      .from(bankTransactions).where(inArray(bankTransactions.id, txIds)),
    supplierIds.length === 0 ? [] : db
      .select({ id: suppliers.id, name: suppliers.nameAr, slug: suppliers.slug })
      .from(suppliers).where(inArray(suppliers.id, supplierIds)),
  ]);
  const today = todayInRiyadh();
  /* عنوانُ البند المؤجَّل كما يُعرض في الطابور — لا معرّفُه */
  const snoozedTitle = rows.some((r) => r.key.startsWith("attn:"))
    ? new Map((await snoozedAttention()).map((s) => [s.item.id, s.item.title]))
    : new Map<string, string>();
  const txOf = new Map(txs.map((t) => [t.id, t]));
  const supOf = new Map(sups.map((s) => [s.id, s]));

  return rows.flatMap((r): ChoiceRow[] => {
    const base = { group: "alert" as const, decidedOn: day(r.at), state: "APPLIED" as const, reason: r.note ? `ملاحظتك: ${r.note}` : null };
    if (r.key.startsWith("double:")) {
      const ids = r.key.split(":").slice(1);
      const first = txOf.get(ids[0] ?? "");
      return [{
        ...base,
        id: `alert:${r.key}`,
        subject: `سدادٌ مرّتين${first?.beneficiary ? ` — ${first.beneficiary.slice(0, 40)}` : ""}${first ? ` — ${formatDay(first.valueDate)}` : ""}`,
        choice: isDoubleDecision(r.decision) ? DOUBLE_PAID_DECISION_LABEL[r.decision] : r.decision,
        effectMinor: first ? first.amountMinor * Math.max(0, ids.length - 1) : null,
        effectLabel: "الزائدُ الذي كان يُطالَب به",
        href: first ? txHref(first.id) : null,
        revoke: {
          url: "/api/alert-resolve", needs: "bank:edit",
          body: { transactionIds: ids, decision: "OPEN" },
          label: "أعِد فتحه",
        },
      }];
    }
    if (r.key.startsWith("bounce:")) {
      const [, outId] = r.key.split(":");
      const out = txOf.get(outId ?? "");
      return [{
        ...base,
        id: `alert:${r.key}`,
        subject: `حوالةٌ خرجت ثمّ عادت${out ? ` — ${formatDay(out.valueDate)}` : ""}`,
        choice: r.decision === "BOUNCED" ? "ارتدّت — رُدّت دفعتُها" : "ليست ردّاً",
        effectMinor: out?.amountMinor ?? null,
        effectLabel: "مبلغُ الحوالة",
        href: out ? txHref(out.id) : null,
        /* «ارتدّت» ردّت دفعةً — لا يُنقَض بضغطةٍ من هنا؛ يُراجَع في ملفّ الحركة */
        revoke: null,
      }];
    }
    if (r.key.startsWith("iban:")) {
      const [, supplierId, iban] = r.key.split(":");
      const s = supOf.get(supplierId ?? "");
      if (!s || !iban) return [];
      return [{
        ...base,
        id: `alert:${r.key}`,
        subject: `${s.name} — حوالةٌ إلى ${groupIban(iban)}`,
        choice: "حسابٌ له أعرفه",
        effectMinor: null,
        effectLabel: null,
        href: `/suppliers/${s.slug}`,
        revoke: {
          url: "/api/iban-guard", needs: "bank:edit",
          body: { supplierId: s.id, iban, decision: "OPEN" },
          label: "أعِد فتحه",
        },
      }];
    }
    if (r.key.startsWith("iban-first:")) {
      const iban = r.key.slice("iban-first:".length);
      return [{
        ...base,
        id: `alert:${r.key}`,
        subject: `حوالةٌ أولى إلى ${groupIban(iban)}`,
        choice: "مستفيدٌ أعرفه",
        effectMinor: null,
        effectLabel: null,
        href: "/bank",
        revoke: {
          url: "/api/iban-guard", needs: "bank:edit",
          body: { iban, decision: "OPEN" },
          label: "أعِد فتحه",
        },
      }];
    }
    if (r.key.startsWith("attn:")) {
      const [, itemId] = r.key.split(":");
      const until = snoozeDay(r.decision);
      /* تأجيلٌ مضى يومُه عاد بندُه — لا اختيارَ قائماً يُعرض */
      const title = snoozedTitle.get(itemId ?? "");
      /* وما تغيّر مبلغُه عاد كذلك — فلا عنوانَ له بين المؤجَّل */
      if (!itemId || until === null || until <= today || !title) return [];
      return [{
        ...base,
        id: `alert:${r.key}`,
        subject: title,
        choice: `أجّلتَه إلى ${formatDay(until)}`,
        effectMinor: null,
        effectLabel: null,
        href: "/attention",
        revoke: {
          url: "/api/attention-snooze", needs: "bank:edit",
          body: { itemId, until: null },
          label: "أعِده الآن",
        },
      }];
    }
    return [];
  });
}

async function supplierRows(): Promise<ChoiceRow[]> {
  const rows = await db
    .select({
      id: suppliers.id, name: suppliers.nameAr, slug: suppliers.slug,
      issuesInvoices: suppliers.issuesInvoices, paperInvoices: suppliers.paperInvoices,
      contractRequired: suppliers.contractRequired, issuesStatements: suppliers.issuesStatements,
      terms: suppliers.paymentTermsDays, limitMinor: suppliers.balanceAlertMinor,
      iban: suppliers.iban, ibanSetAt: suppliers.ibanSetAt, ibanBy: users.name,
    })
    .from(suppliers)
    .leftJoin(users, eq(users.id, suppliers.ibanSetById))
    .where(sql`${suppliers.isActive} and (
      not ${suppliers.issuesInvoices} or ${suppliers.paperInvoices} or not ${suppliers.contractRequired}
      or not ${suppliers.issuesStatements} or ${suppliers.paymentTermsDays} is not null
      or ${suppliers.balanceAlertMinor} is not null or ${suppliers.iban} is not null)`)
    .orderBy(suppliers.nameAr);
  const withIban = rows.filter((r) => r.iban).map((r) => r.id);
  const payee = await loadPayeeAccounts(withIban);

  const out: ChoiceRow[] = [];
  for (const s of rows) {
    const href = `/suppliers/${s.slug}`;
    const flag = (key: string, choice: string, body: Record<string, boolean>, label: string) => out.push({
      id: `supplier:${s.id}:${key}`, group: "supplier", subject: s.name, choice,
      decidedOn: null, effectMinor: null, effectLabel: null, state: "APPLIED", reason: null, href,
      revoke: { url: "/api/supplier-policy", needs: "supplier:edit", body: { supplierId: s.id, ...body }, label },
    });
    if (!s.issuesInvoices) flag("no-invoices", "لا يصدر فواتير ضريبيّة — لا يُطالَب بها", { issuesInvoices: true }, "أعِده: يصدر فواتير");
    if (s.paperInvoices) flag("paper", "فواتيرُه ورقيّةٌ تُسلَّم باليد", { paperInvoices: false }, "أعِده: ليست ورقيّة");
    if (!s.contractRequired) flag("no-contract", "لا يُطلَب منه عقدُ توريد", { contractRequired: true }, "أعِده: يُطلَب عقد");
    if (!s.issuesStatements) flag("no-statements", "لا يصدر كشفَ حساب — لا يُطلَب منه", { issuesStatements: true }, "أعِده: يصدر كشفاً");
    const inFile = (key: string, choice: string, effectMinor: number | null, effectLabel: string | null, extra: Partial<ChoiceRow> = {}) => out.push({
      id: `supplier:${s.id}:${key}`, group: "supplier", subject: s.name, choice,
      decidedOn: null, effectMinor, effectLabel, state: "APPLIED", reason: null, href, revoke: null, ...extra,
    });
    if (s.terms !== null) inFile("terms", s.terms === 0 ? "أجلُ السداد: نقداً" : `أجلُ السداد: ${countNoun(s.terms, DAY)}`, null, null);
    if (s.limitMinor !== null) inFile("limit", "حدٌّ للرصيد يفتح تنبيهاً", s.limitMinor, "الحدّ");
    if (s.iban) {
      const note = payee.get(s.id)?.note ?? null;
      inFile("iban", `آيبانٌ مكتوبٌ بيد: ${groupIban(s.iban)}${s.ibanBy ? ` — كتبه ${s.ibanBy}` : ""}`, null, null, {
        decidedOn: day(s.ibanSetAt),
        /* مكتوبٌ بيد ويخالف الكشوف: يمضي كما كُتب، ويُقال هنا كما يُقال في ملفّ التحويل */
        reason: note,
      });
    }
  }
  return out;
}

async function ruleRows(): Promise<ChoiceRow[]> {
  const rows = (await db.execute<{
    id: string; pattern: string; category: string; supplier: string | null; note: string | null;
    created_on: string; n: number; total: string;
  }>(sql`
    select r.id, r.pattern, r.category::text as category, s.name_ar as supplier, r.note,
           to_char(r.created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as created_on,
           (select count(*)::int from bank_transactions bt where bt.rule_id = r.id) as n,
           (select coalesce(sum(bt.amount_minor), 0)::bigint from bank_transactions bt where bt.rule_id = r.id) as total
      from ${bankRules} r left join suppliers s on s.id = r.supplier_id
     where r.source = 'MANUAL'
     order by r.created_at desc
  `)).rows;
  return rows.map((r): ChoiceRow => {
    const n = Number(r.n);
    return {
      id: `rule:${r.id}`,
      group: "rule",
      subject: `«${r.pattern}»`,
      choice: `${isTxCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category}${r.supplier ? ` — ${r.supplier}` : ""}`,
      decidedOn: r.created_on,
      effectMinor: n > 0 ? Number(r.total) : null,
      effectLabel: n > 0 ? `صُنِّفت بها ${countNoun(n, TRANSACTION)}` : null,
      /* قاعدةٌ لم تُصنَّف بها حركةٌ واحدة قائمةٌ ولا تعمل — تُقال كذلك */
      state: n > 0 ? "APPLIED" : "NOT_APPLIED",
      reason: n > 0 ? r.note : "لم تُصنَّف بها حركةٌ بعد — قد يكون نصُّها لا يطابق وصفَ البنك، أو سبقتها قاعدةٌ أخرى",
      href: "/settings#rules",
      revoke: null,
    };
  });
}

async function waiverRows(): Promise<ChoiceRow[]> {
  const rows = await db
    .select({
      id: issues.id, message: issues.message, reason: issues.waiverReason, at: issues.resolvedAt,
      entityType: issues.entityType, entityId: issues.entityId,
    })
    .from(issues)
    .where(eq(issues.status, "WAIVED"))
    .orderBy(desc(issues.resolvedAt))
    .limit(100);
  return rows.map((r): ChoiceRow => ({
    id: `waiver:${r.id}`,
    group: "waiver",
    subject: r.message.slice(0, 120),
    choice: r.reason ? `تجاوزتَها — «${r.reason}»` : "تجاوزتَها",
    decidedOn: day(r.at),
    effectMinor: null,
    effectLabel: null,
    state: "APPLIED",
    reason: null,
    href: r.entityType === "invoice" ? invoiceHref(r.entityId)
      : r.entityType === "document" ? `/documents/file/${encodeURIComponent(r.entityId)}`
      : null,
    revoke: null,
  }));
}

export async function loadChoiceLedger(): Promise<ChoiceLedger> {
  const [vat, cash, holds, alerts, sups, rules, waivers] = await Promise.all([
    vatChoiceRows(), cashRows(), holdRows(), alertRows(), supplierRows(), ruleRows(), waiverRows(),
  ]);
  return {
    ...summarizeChoices([...vat.rows, ...cash, ...holds, ...alerts, ...sups, ...rules, ...waivers]),
    olderVatChoices: vat.older,
  };
}
