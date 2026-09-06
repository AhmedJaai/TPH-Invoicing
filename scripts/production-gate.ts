/**
 * بوّابة الإنتاج — الحكم يُشتقّ من فحوصٍ تجري، لا يُكتَب.
 *
 *   npm run ops:gate
 *
 * قراءةٌ محضة. وكلّ بندٍ يُفحَص فعلاً أو يُعلَن أنّه **لم يُفحَص**.
 * و«لم يُفحَص» تمنع الجاهزية كما يمنعها الفشل: بوّابةٌ تعدّ غير المفحوص
 * ناجحاً تُنتج ثقةً بلا سند.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  GATE_LABEL, GATE_MARK, buildGate, type GateCheck,
} from "@/lib/ops/production-gate";
import { checkBalance } from "@/lib/bank/balance-equation";

const EXPECTED_MIGRATIONS = 17;

/** ما لا يُفحَص آلياً — ويُقَرّ في ملفٍّ يوقّعه إنسان. */
interface ManualAttestation {
  secretsRotated?: { at: string; by: string };
  backupTaken?: { at: string; by: string };
  isolationVerified?: { at: string; by: string; productionId: string; previewId: string };
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** عمرُ النتيجة — شهادةٌ عمرُها أسبوع لا تصف اليوم. */
function ageOf(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  return `قبل ${days} يوماً`;
}

function readAttestation(): ManualAttestation {
  try {
    return JSON.parse(readFileSync("ops-attestation.json", "utf8")) as ManualAttestation;
  } catch {
    return {};
  }
}

async function main() {
  const checks: GateCheck[] = [];
  const att = readAttestation();

  const add = (
    key: string,
    status: GateCheck["status"],
    detail: string,
    remedy?: string,
    manual?: boolean,
  ) => checks.push({ key, label: GATE_LABEL[key] ?? key, status, detail, remedy, manual });

  /* ── ١ · سلامة الهجرات ── */
  const applied = (
    await db.execute<{ name: string }>(sql`select name from schema_migrations order by name`)
  ).rows.map((r) => r.name);

  add(
    "migration_integrity",
    applied.length === EXPECTED_MIGRATIONS ? "PASS" : "FAIL",
    `${applied.length} من ${EXPECTED_MIGRATIONS} مطبَّقة` +
      (applied.length < EXPECTED_MIGRATIONS
        ? ` — الناقص يبدأ من ${String(applied.length + 1).padStart(3, "0")}`
        : ""),
    applied.length < EXPECTED_MIGRATIONS ? "npm run db:migrate" : undefined,
  );

  /* ── ٢ · سلامة القاعدة: الأعمدة التي تكتب فيها الشيفرة موجودة ── */
  const need: [string, string][] = [
    ["payments", "status"], ["payments", "fee_minor"], ["payments", "reversed_at"],
    ["bank_transactions", "lifecycle"], ["bank_transactions", "bank_account_id"],
    ["bank_imports", "bank_account_id"], ["expenses", "event_key"],
    ["sales", "branch_id"], ["supplier_products", "content_unit"],
  ];
  const missing: string[] = [];
  for (const [table, column] of need) {
    const [r] = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from information_schema.columns
         where table_name = ${table} and column_name = ${column}
      `)
    ).rows;
    if (Number(r?.n ?? 0) === 0) missing.push(`${table}.${column}`);
  }
  add(
    "database_integrity",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0
      ? `${need.length} عموداً تكتب فيه الشيفرة — كلّها موجودة`
      : `أعمدة ناقصة: ${missing.join("، ")}`,
    missing.length > 0 ? "npm run db:migrate" : undefined,
  );

  /* ── ٣ · الثوابت المالية مفروضةٌ في القاعدة لا في الشيفرة وحدها ── */
  const [constraints] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_constraint
       where conname in (
         'invoices_parts_sum_to_total', 'invoices_parts_non_negative',
         'payments_fee_within_amount', 'payments_status_matches_marks',
         'payments_reversal_has_reason'
       )
    `)
  ).rows;
  add(
    "financial_invariants",
    Number(constraints?.n ?? 0) >= 5 ? "PASS" : "FAIL",
    `${Number(constraints?.n ?? 0)} من ٥ قيودٍ ماليّة مفروضة في القاعدة`,
    "npm run db:migrate ثمّ npm run db:verify",
  );

  /* ── ٤ · تسوية البنك: المعادلة والفجوة ── */
  const [bank] = (
    await db.execute<Record<string, number | null>>(sql`
      select coalesce(sum(amount_minor) filter (where direction='CREDIT'),0)::int as credits,
             coalesce(sum(amount_minor) filter (where direction='DEBIT'),0)::int  as debits,
             (select sum(opening_balance_minor)::int from reconciliation_periods) as opening,
             (select sum(closing_balance_minor)::int from reconciliation_periods) as closing,
             count(*)::int as total
        from bank_transactions
    `)
  ).rows;

  const balance = checkBalance({
    openingMinor: bank?.opening ?? null,
    closingMinor: bank?.closing ?? null,
    creditsMinor: Number(bank?.credits ?? 0),
    debitsMinor: Number(bank?.debits ?? 0),
  });

  add(
    "bank_reconciliation",
    balance.status === "BALANCED" || balance.status === "WITHIN_TOLERANCE" ? "PASS"
      : balance.status === "UNKNOWN" ? "UNKNOWN" : "FAIL",
    `${Number(bank?.total ?? 0)} حركة · ${balance.reason}`,
    balance.status === "UNKNOWN"
      ? "أدخل رصيدَي أوّل المدّة وآخرها في reconciliation_periods"
      : "راجع الكشف — الفرق يعني حركاتٍ لم تُقرأ",
  );

  /* ── ٥ · دورة الفاتورة: لا فاتورة بلا أصل، ولا تخصيصٌ فوق قيمتها ── */
  const [inv] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from invoices where document_id is null)          as orphan,
        (select count(*)::int from invoices i where coalesce((
           select sum(pa.amount_minor)::int from payment_allocations pa
            where pa.invoice_id = i.id), 0) > i.total_minor + 1)                as overallocated,
        (select count(*)::int from invoices)                                    as total
    `)
  ).rows;
  const invBad = Number(inv?.orphan ?? 0) + Number(inv?.overallocated ?? 0);
  add(
    "invoice_lifecycle",
    invBad === 0 ? "PASS" : "FAIL",
    invBad === 0
      ? `${Number(inv?.total ?? 0)} فاتورة — لكلٍّ أصلُها، ولا تخصيص فوق قيمتها`
      : `${Number(inv?.orphan ?? 0)} بلا أصل · ${Number(inv?.overallocated ?? 0)} مخصَّصٌ فوقها`,
    "npm run db:repair — بعد مراجعة db:audit",
  );

  /* ── ٦ · دورة الدفعة: الحال المحفوظ يوافق تخصيصاته ── */
  const hasStatus = !missing.includes("payments.status");
  if (!hasStatus) {
    add("payment_lifecycle", "UNKNOWN", "العمود `status` غير موجود — لم يُفحَص", "npm run db:migrate");
  } else {
    const [pay] = (
      await db.execute<Record<string, number>>(sql`
        select count(*)::int as mismatched from payments p
         where p.reversed_at is null and p.voided_at is null
           and p.status <> (case
             when coalesce((select sum(amount_minor)::int from payment_allocations
                             where payment_id = p.id), 0) = 0
               then (case when p.is_advance then 'ADVANCE' else 'UNAPPLIED' end)
             when p.amount_minor - p.fee_minor - coalesce((select sum(amount_minor)::int
                    from payment_allocations where payment_id = p.id), 0) >  1
               then 'PARTIALLY_APPLIED'
             when p.amount_minor - p.fee_minor - coalesce((select sum(amount_minor)::int
                    from payment_allocations where payment_id = p.id), 0) < -1
               then 'OVERPAYMENT'
             else 'APPLIED' end)::payment_status
      `)
    ).rows;
    add(
      "payment_lifecycle",
      Number(pay?.mismatched ?? 0) === 0 ? "PASS" : "FAIL",
      Number(pay?.mismatched ?? 0) === 0
        ? "الحال المحفوظ يوافق التخصيصات في كلّ دفعة"
        : `${Number(pay?.mismatched ?? 0)} دفعةً حالُها يخالف تخصيصاتها`,
      "أعد الاستيراد أو صحّح يدوياً — العمود الذي يخالف الحقيقة أسوأ من غيابه",
    );
  }

  /* ── ٧ · كشوف المورّدين ── */
  const [stmt] = (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from statements)      as total,
             (select count(*)::int from statement_lines) as lines,
             (select count(*)::int from statements s
               where not exists (select 1 from statement_lines l
                                  where l.statement_id = s.id)) as empty
    `)
  ).rows;
  const stmtTotal = Number(stmt?.total ?? 0);
  const stmtEmpty = Number(stmt?.empty ?? 0);
  /*
    الكشف المؤرشَف غير الكشف المطابَق.

    أرشفتُه تُنشئ صفَّه، ومطابقتُه — من `/statements` — هي التي تقرأ
    أسطره. فكشفٌ بلا أسطر ليس بياناتٍ فاسدة بل **عملاً لم يُنجَز**،
    وهذا فرقٌ يجب أن تعرفه البوّابة: لو سمّته فشلاً لطالبت بإصلاح ما
    ليس مكسوراً، ولو سمّته نجاحاً لادّعت أنّ المسار جُرّب وهو لم يُجرَّب.

    والعدّ وحده يُخفي الفرق: «١١ كشفاً» تبدو نجاحاً.
  */
  add(
    "supplier_statements",
    stmtTotal === 0 || stmtEmpty === stmtTotal ? "UNKNOWN"
      : stmtEmpty === 0 ? "PASS" : "FAIL",
    stmtTotal === 0
      ? "لا كشف مورّدٍ مؤرشَف — لم يُفحَص المسار"
      : stmtEmpty === stmtTotal
        ? `${stmtTotal} كشفاً مؤرشَفاً، ولم يُطابَق منها واحد — المسار لم يُجرَّب`
        : stmtEmpty > 0
          ? `${stmtEmpty} من ${stmtTotal} كشفاً مؤرشَفاً بلا مطابقة`
          : `${stmtTotal} كشفاً · ${Number(stmt?.lines ?? 0)} سطراً مطابَقاً`,
    "طابِق كشفاً واحداً على الأقلّ من /statements",
  );

  /* ── ٨ · إقفال الشهر ── */
  const [close] = (
    await db.execute<Record<string, number>>(sql`
      select count(*)::int as closed from month_closes where status = 'CLOSED'
    `)
  ).rows;
  add(
    "month_close",
    Number(close?.closed ?? 0) > 0 ? "PASS" : "UNKNOWN",
    Number(close?.closed ?? 0) > 0
      ? `${Number(close?.closed ?? 0)} شهراً مقفلاً`
      : "لم يُقفَل شهرٌ بعد — لم يُثبَت أنّ المسار يعمل",
    "أقفل أغسطس ٢٠٢٦ من /close",
  );

  /* ── ٩ · مسار المراجعة: كلّ إقرارٍ له أثرٌ في تاريخ القرار ── */
  const hasHistory = applied.includes("013_decision_provenance.sql");
  if (!hasHistory) {
    add("review_workflow", "UNKNOWN", "`decision_history` غير موجود", "npm run db:migrate");
  } else {
    /*
      ولا يُحاسَب القديم بما لم يكن موجوداً.

      `decision_history` وُلد في `013`. وحركةٌ قُيّدت قبله لا أثر لها
      فيه — وهذا ليس عطباً بل تاريخاً. والفحص يقتصر على ما وقع بعد
      أوّل سجلٍّ فيه: ما بعده يجب أن يحمل أثره، وما قبله لا يُسأل.
    */
    const [rev] = (
      await db.execute<Record<string, number | string | null>>(sql`
        -- created_at لا at: مساعد now() يسمّي كلّ عمودٍ كذلك مهما كان اسمُه
        -- في TypeScript. ومن يكتب SQL خاماً يقع فيها.
        with born as (select min(created_at) as at from decision_history)
        select
          (select count(*)::int from decision_history where event = 'MATCH_CONFIRMED') as confirmed,
          (select count(*)::int from decision_history where event = 'MATCH_REVERSED')  as reversed,
          (select to_char(at, 'YYYY-MM-DD') from born)                                 as since,
          (select count(*)::int from bank_transactions t
             join bank_imports i on i.id = t.bank_import_id
            where t.matched_payment_id is not null
              and i.created_at >= (select at from born)
              and not exists (select 1 from decision_history h
                               where h.bank_transaction_id = t.id
                                 and h.event in ('POSTED','MATCH_CONFIRMED')))         as posted_silently,
          (select count(*)::int from bank_transactions t
             join bank_imports i on i.id = t.bank_import_id
            where t.matched_payment_id is not null
              and i.created_at < (select at from born))                                as legacy
      `)
    ).rows;

    const silent = Number(rev?.posted_silently ?? 0);
    const legacy = Number(rev?.legacy ?? 0);
    const confirmed = Number(rev?.confirmed ?? 0);
    const since = rev?.since ? String(rev.since) : null;
    const legacyNote = legacy > 0 ? ` (و${legacy} حركةً أقدم من السجلّ نفسه — لا تُسأل)` : "";

    add(
      "review_workflow",
      silent > 0 ? "FAIL"
        : confirmed > 0 || since !== null ? "PASS"
        : "UNKNOWN",
      silent > 0
        ? `${silent} حركةً قُيّدت بعد ${since} بلا أثرٍ في تاريخ القرار${legacyNote}`
        : since === null
          ? "لا سجلَّ قرارٍ بعد — لم يُفحَص المسار"
          : `${confirmed} إقراراً · ${Number(rev?.reversed ?? 0)} ردّاً — ولا حركةَ قُيّدت صامتةً منذ ${since}${legacyNote}`,
      "أقِرّ اقتراحاً واحداً من /review",
    );
  }

  /* ── ١٠ · سجلّ التدقيق: يُكتَب ولا يُعدَّل ── */
  const [audit] = (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from audit_logs)                                as rows,
             (select count(*)::int from pg_trigger
               where tgrelid = 'audit_logs'::regclass and not tgisinternal)        as guards
    `)
  ).rows;
  add(
    "audit_trail",
    Number(audit?.guards ?? 0) > 0 && Number(audit?.rows ?? 0) > 0 ? "PASS" : "FAIL",
    `${Number(audit?.rows ?? 0)} سجلاًّ · ${Number(audit?.guards ?? 0)} مؤثِّراً يمنع التعديل والحذف`,
    "npm run db:migrate — المؤثِّرات في 001",
  );

  /* ── ١١ · سلامة الأرشيف ── */
  const [drive] = (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from documents)                              as docs,
             (select count(*)::int from documents where drive_file_id is null)  as unlinked
    `)
  ).rows;
  add(
    "drive_integrity",
    Number(drive?.docs ?? 0) === 0 ? "UNKNOWN"
      : Number(drive?.unlinked ?? 0) === 0 ? "PASS" : "FAIL",
    Number(drive?.docs ?? 0) === 0
      ? "لا مستند — لم يُفحَص"
      : `${Number(drive?.docs ?? 0)} مستنداً · ${Number(drive?.unlinked ?? 0)} بلا رابطٍ إلى أصله`,
    "npm run ops:truth — للمقابلة الكاملة",
  );

  /* ── ١٢–١٥ · ما يُقِرّه إنسان ── */
  add(
    "preview_isolation",
    att.isolationVerified ? "PASS" : "UNKNOWN",
    att.isolationVerified
      ? `أُثبت في ${att.isolationVerified.at} — ${att.isolationVerified.productionId} ≠ ${att.isolationVerified.previewId}`
      : "لم يُثبَت — ولا يُفترَض",
    "افتح /api/ops/db-identity في الإنتاج والمعاينة، ثمّ سجّل في ops-attestation.json",
    true,
  );

  add(
    "security_scan",
    att.secretsRotated ? "PASS" : "UNKNOWN",
    att.secretsRotated
      ? `المفتاحان دُوّرا في ${att.secretsRotated.at}`
      : "GEMINI_API_KEY و GOOGLE_CLIENT_SECRET ظهرا في محادثة — ولم يُقَرّ تدويرهما",
    "انظر SECURITY.md، ثمّ سجّل في ops-attestation.json",
    true,
  );

  /*
    والنتيجتان تُقرآن من ملفّيهما لا تُنقَلان باليد — وما يُنقَل باليد
    يُنقَل خطأً. وقِدَمُ الملفّ يُعلَن: شهادةٌ عمرُها أسبوع لا تصف اليوم.
    */
  const certify = readJson<{ at: string; total: number; passed: number }>("certify-result.json");
  add(
    "end_to_end_tests",
    certify === null ? "UNKNOWN" : certify.passed === certify.total ? "PASS" : "FAIL",
    certify === null
      ? "لم تُشغَّل الشهادة بعد"
      : `${certify.passed} من ${certify.total} سيناريو · ${ageOf(certify.at)}`,
    "npm run ops:certify",
  );

  const truth = readJson<{ at: string; counts: Record<string, number> }>("truth-audit.json");
  const c = truth?.counts;
  add(
    "real_data_verification",
    truth === null ? "UNKNOWN"
      : (c?.CORRECTED ?? 0) + (c?.DUPLICATE ?? 0) + (c?.MISSING ?? 0) === 0 ? "PASS" : "FAIL",
    truth === null
      ? "لم يُشغَّل تدقيق الحقيقة بعد"
      : `مطابق ${c?.VERIFIED ?? 0} · يحتاج تصحيحاً ${c?.CORRECTED ?? 0} · ` +
        `مكرَّر ${c?.DUPLICATE ?? 0} · مفقود ${c?.MISSING ?? 0} · ` +
        `لا يُقطَع فيه ${c?.AMBIGUOUS ?? 0} · ${ageOf(truth.at)}`,
    "npm run ops:truth",
  );

  /* ── التقرير ── */
  const report = buildGate(checks);

  console.log("\n═══════════ PRODUCTION READINESS ═══════════\n");
  for (const c of report.checks) {
    console.log(`  ${GATE_MARK[c.status]}  ${c.label}`);
    console.log(`        ${c.detail}`);
    if (c.status !== "PASS" && c.remedy) console.log(`        → ${c.remedy}`);
    console.log("");
  }

  console.log("───────────────────────────────────────────\n");
  console.log(`  ${report.verdict}\n`);

  process.exit(report.ready ? 0 : 1);
}

main().catch((e) => { console.error("\n✕", e.message, "\n"); process.exit(1); });
