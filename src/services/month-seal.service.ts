/**
 * ختمُ أرقام الشهر عند إقفاله، وفحصُ الصباح عمّا تغيّر منها (`lib/month-seal.ts`).
 *
 * الأرقامُ من الخدمات التي ترسم الشاشات، لا حسابٌ ثانٍ:
 *   · «عليك» لكلّ مورّدٍ ومجموعُه — `loadSupplierBalancesAsOf` بمعادلة `supplierBalance`
 *     نفسها، على ما يقع في الشهر وقبله.
 *   · رصيدُ ختام كلّ حساب من فترات التسوية (`balancesByAccount` في قائمة الإقفال)، وواردُه
 *     وصادرُه في الشهر بتوقيت الرياض — الشهرُ الذي يقفله مؤثِّرُ حركة البنك (٠٨٨).
 *   · ضريبتا المخرجات والمدخلات للشهر — `loadVatReturn` كما في «إقرار الضريبة».
 *
 * الختمُ يُضاف ولا يُعدَّل (مؤثِّرٌ في القاعدة). وإعادةُ الإقفال بعد فتحٍ تكتب ختماً جديداً،
 * والصالحُ آخرُ ختمٍ كُتب بعد آخر إقفال. وشهرٌ أُقفل قبل وجود الختم يُختم عند أوّل فحصٍ
 * بعده (`BACKFILL`) — فيُقال إنّه خُتم يومَ الفحص لا يومَ الإقفال.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthSeals } from "@/db/schema";
import { balancesByAccount } from "@/lib/month-close";
import { monthEndDay } from "@/lib/riyadh-time";
import { totalBalances } from "@/lib/supplier-balances";
import {
  NOT_SEALED, SEAL_VERSION, diffSealedFigures, readDriftCheck, readSealedFigures,
  type DriftCheck, type SealedFigures,
} from "@/lib/month-seal";
import { loadSupplierBalancesAsOf } from "./supplier-balance.service";
import { loadVatReturn } from "./vat-return.service";
import { latestDailyCheck, recordDailyCheck } from "./daily-checks.service";
import type { Conn } from "./types";

/** أرقامُ الشهر كما تُحسب الآن. */
export async function computeMonthFigures(month: string, conn: Conn = db): Promise<SealedFigures> {
  const monthStart = `${month}-01`;
  const monthEnd = monthEndDay(month);
  const [balances, bankRows, periodRows, vat] = await Promise.all([
    loadSupplierBalancesAsOf(month, conn),
    conn.execute<{ account: string | null; label: string | null; credits: string | number; debits: string | number }>(sql`
      select bt.bank_account_id as account, coalesce(nullif(ba.label, ''), ba.bank_name) as label,
             coalesce(sum(bt.amount_minor) filter (where bt.direction = 'CREDIT'), 0)::bigint as credits,
             coalesce(sum(bt.amount_minor) filter (where bt.direction = 'DEBIT'), 0)::bigint as debits
        from bank_transactions bt
        left join bank_accounts ba on ba.id = bt.bank_account_id
       where to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM') = ${month}
       group by bt.bank_account_id, ba.label, ba.bank_name
    `),
    /* الفتراتُ نفسُها التي تقرؤها قائمةُ الإقفال (`gatherMonthFacts`) */
    conn.execute<{ account: string; label: string | null; ps: string; pe: string; opening: number | null; closing: number | null; reviewed: boolean }>(sql`
      select rp.bank_account_id as account, coalesce(nullif(ba.label, ''), ba.bank_name) as label,
             rp.period_start as ps, rp.period_end as pe,
             rp.opening_balance_minor as opening, rp.closing_balance_minor as closing,
             (rp.reviewed_at is not null) as reviewed
        from reconciliation_periods rp
        left join bank_accounts ba on ba.id = rp.bank_account_id
       where rp.period_start >= ${monthStart} and rp.period_end <= ${monthEnd}
    `),
    loadVatReturn({ kind: "month", month }, conn),
  ]);

  const owing = balances.filter((b) => b.owedMinor > 0);
  const names = owing.length === 0 ? new Map<string, string>() : new Map(
    (await conn.execute<{ id: string; name: string }>(sql`
      select id, name_ar as name from suppliers where id in (${sql.join(owing.map((b) => sql`${b.supplierId}`), sql`, `)})
    `)).rows.map((r) => [r.id, r.name]),
  );

  const closing = balancesByAccount(periodRows.rows.map((p) => ({
    bankAccountId: p.account, periodStart: p.ps, periodEnd: p.pe,
    openingMinor: p.opening === null ? null : Number(p.opening),
    closingMinor: p.closing === null ? null : Number(p.closing),
    reviewed: Boolean(p.reviewed),
  })));
  const labels = new Map<string, string>();
  for (const p of periodRows.rows) if (p.label) labels.set(p.account, p.label);
  const bank: SealedFigures["bank"] = bankRows.rows.map((r) => ({
    accountId: r.account,
    label: r.label ?? (r.account ? "حساب بنكيّ" : "حساب غير محدَّد"),
    closingMinor: r.account ? closing.get(r.account)?.closingMinor ?? null : null,
    creditsMinor: Number(r.credits),
    debitsMinor: Number(r.debits),
  }));
  /* حسابٌ له رصيدٌ في كشفه ولا حركةَ له في الشهر يُختم برصيده */
  for (const [account, b] of closing) {
    if (!bank.some((x) => x.accountId === account)) {
      bank.push({ accountId: account, label: labels.get(account) ?? "حساب بنكيّ", closingMinor: b.closingMinor, creditsMinor: 0, debitsMinor: 0 });
    }
  }
  bank.sort((a, b) => (a.accountId ?? "").localeCompare(b.accountId ?? ""));

  return {
    v: SEAL_VERSION,
    owed: {
      totalMinor: totalBalances(balances).owedMinor,
      suppliers: owing
        .map((b) => ({ id: b.supplierId, name: names.get(b.supplierId) ?? "مورّد", owedMinor: b.owedMinor }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
    bank,
    vat: { outputVatMinor: vat.result.output.vatMinor, inputVatMinor: vat.result.input.totalMinor, netMinor: vat.result.netMinor },
    notSealed: [...NOT_SEALED],
  };
}

export interface SealOptions {
  actorId: string | null;
  origin: "CLOSE" | "BACKFILL";
  /** وقتُ الختم — يُمرَّر في الاختبار ليُعرف الأحدث بين ختمين في معاملةٍ واحدة. */
  at?: Date;
}

/** يختم أرقامَ الشهر كما تُحسب الآن، ويُرجع معرّفَ الختم. */
export async function sealMonth(month: string, opts: SealOptions, conn: Conn = db): Promise<string> {
  const figures = await computeMonthFigures(month, conn);
  const [row] = await conn.insert(monthSeals)
    .values({ month, origin: opts.origin, figures, sealedById: opts.actorId, sealedAt: opts.at ?? new Date() })
    .returning({ id: monthSeals.id });
  return row.id;
}

type ValidSeal = { id: string; month: string; figures: unknown };

/** آخرُ ختمٍ لكلّ شهرٍ مقفلٍ الآن، كُتب بعد آخر إقفاله. */
async function validSeals(conn: Conn, withFigures = true): Promise<ValidSeal[]> {
  return (await conn.execute<ValidSeal>(sql`
    select distinct on (s.month) s.id, s.month, ${withFigures ? sql`s.figures` : sql`null`} as figures
      from month_seals s
      join month_closes mc on mc.month = s.month and mc.status = 'CLOSED'
     where s.sealed_at >= coalesce(mc.closed_at, '-infinity'::timestamptz)
     order by s.month, s.sealed_at desc, s.id desc
  `)).rows;
}

/** أشهرٌ مقفلة بلا ختمٍ صالح — أُقفلت قبل وجوده، أو تعثّر ختمُها عند الإقفال. */
export async function unsealedClosedMonths(conn: Conn = db): Promise<string[]> {
  return (await conn.execute<{ month: string }>(sql`
    select mc.month from month_closes mc
     where mc.status = 'CLOSED'
       and not exists (
         select 1 from month_seals s
          where s.month = mc.month and s.sealed_at >= coalesce(mc.closed_at, '-infinity'::timestamptz))
     order by mc.month
  `)).rows.map((r) => r.month);
}

/**
 * يعيد حسابَ كلّ شهرٍ مقفلٍ مختوم ويقارنه بختمه — قراءةٌ وحدها (وبها تفحص البوّابة).
 * وختمٌ لا يُقرأ بشكله (نسخةٌ أخرى) يُتخطّى ولا يُخترَع له فرق.
 */
export async function checkSealedMonths(conn: Conn = db): Promise<DriftCheck & { unsealed: string[] }> {
  const [seals, unsealed] = await Promise.all([validSeals(conn), unsealedClosedMonths(conn)]);
  const findings: DriftCheck["findings"] = [];
  let months = 0;
  /* متتابعةٌ: إقرارُ كلّ شهرٍ عدّةُ استعلامات، وستّةٌ معاً تزحم التجمّع */
  for (const s of seals) {
    const sealed = readSealedFigures(s.figures);
    if (!sealed) continue;
    months++;
    const now = await computeMonthFigures(s.month, conn);
    for (const d of diffSealedFigures(s.month, sealed, now)) findings.push({ sealId: s.id, ...d });
  }
  return { months, findings, unsealed };
}

export interface SealCheckSummary {
  /** أشهرٌ خُتمت الآن لأوّل مرّة. */
  sealedNow: string[];
  months: number;
  findings: DriftCheck["findings"];
}

/** فحصُ الصباح: يختم ما لم يُختم، ثمّ يقارن، ثمّ يحفظ ما وجده لـ«يحتاج قرارك». */
export async function runSealCheck(actorId: string | null, conn: Conn = db): Promise<SealCheckSummary> {
  const sealedNow = await unsealedClosedMonths(conn);
  for (const month of sealedNow) await sealMonth(month, { actorId, origin: "BACKFILL" }, conn);
  const { months, findings } = await checkSealedMonths(conn);
  await recordDailyCheck("SEAL_DRIFT", { months, findings } satisfies DriftCheck, conn);
  return { sealedNow, months, findings };
}

export interface SealDriftFact {
  checkedAt: Date;
  findings: DriftCheck["findings"];
}

/**
 * ما وجده آخرُ فحص، وما زال قائماً: الفرقُ على ختمٍ ما زال الصالحَ لشهرٍ ما زال مقفلاً.
 * فإن أُعيد فتحُ الشهر أو أُعيد إقفالُه (ختمٌ جديد) سقط فرقُه — ولا ينتظر صباحَ الغد.
 */
export async function loadSealDrift(conn: Conn = db): Promise<SealDriftFact | null> {
  const last = await latestDailyCheck("SEAL_DRIFT", conn);
  const check = last ? readDriftCheck(last.payload) : null;
  if (!last || !check || check.findings.length === 0) return null;
  const current = new Set((await validSeals(conn, false)).map((s) => s.id));
  const findings = check.findings.filter((f) => current.has(f.sealId));
  return findings.length > 0 ? { checkedAt: last.checkedAt, findings } : null;
}
