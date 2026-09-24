/**
 * المزامنة التدريجية مع الدرايف.
 *
 * قراءة الأرشيف كاملاً بمحتواه عمل يُفعل مرّة واحدة. وبعدها لا يبقى إلا
 * سؤال واحد: هل ظهر في الدرايف ملف لا سجلّ له عندنا؟ — كملف رفعه أحدهم
 * بيده. فهذه الواجهة تقارن معرّفات ملفات الدرايف بما في القاعدة وتضيف
 * الفرق وحده، ولا تعيد قراءة ما قُرئ.
 *
 * والملف الذي لا يُفهم اسمه — وهو حال ما يُرفع يدوياً — يُقرأ محتواه.
 * وذلك أبطأ، فيُعالَج عدد محدود في كل طلب والباقي في الطلب التالي.
 */
import { refreshTokenFor } from "@/services/drive.service";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  documents, invoices, payments, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { DriveAuthExpiredError, driveForUser, downloadFile, getFileMeta, isDriveAuthError } from "@/lib/drive";
import { recentMonths, walkArchive, type ArchiveEntry } from "@/lib/drive-sync";
import { parseFileName } from "@/lib/naming";
import { KNOWN_SLUGS } from "@/lib/suppliers-seed";
import { planImport } from "@/lib/archive-import";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { extractDocument } from "@/lib/extraction";
import { reviewConfirmed } from "@/lib/confirm";
import { parseRiyals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";
import { createPayment, PaymentTwinError } from "@/services/payment.service";
import { createInvoice, replaceLines } from "@/services/invoice.service";
import { firstClosedMonth } from "@/services/month-guard";
import { MonthClosedError } from "@/services/validation.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { canonicalName } from "@/lib/canonical-name";
import { autoArchive, type AutoArchiveGap } from "@/lib/extraction/auto-archive";
import { renameArchived } from "@/services/drive-rename.service";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { FILE, MONTH, countNoun } from "@/lib/arabic";
import { withDeadline } from "@/lib/ai/deadline";
import { consume } from "@/services/rate-limit.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** حدّ لكل طلب: الاستدعاء السحابي له سقف زمني، والباقي يكمله الطلب التالي. */
const MAX_NAMED_PER_CALL = 60;
const MAX_CONTENT_PER_CALL = 2;

/**
 * ميزانيّةُ الطلب الواحد — والوقتُ مورِدٌ يُقسَم لا يُفترَض.
 *
 * سقفُ المزوّد ستّون ثانية. والعمل ثلاثةُ أقسام: مشيٌ على الأرشيف،
 * ثمّ قراءةُ محتوى ما لا يُفهم اسمُه، ثمّ كتابة. وأثقلُها الثاني: كلّ
 * ملفٍّ يُنزَّل ويُستخرَج بنموذج — عشرُ ثوانٍ أو أكثر للواحد. فأربعةٌ
 * منها وحدها قد تستغرق الدقيقة.
 *
 * وكانت المهلة على المشي وحده، فيقف المشي في وقته ثمّ تلتهم القراءةُ
 * الباقي ويُقتَل الطلب — فيبدو للمستخدم أنّ «سجّل الجديد» لا يعمل.
 *
 * فصار لكلّ قسمٍ حدُّه، ولآخر الطلب فسحةٌ تكفي للكتابة والردّ. واثنان
 * في الطلب لا أربعة: آخرُ ملفٍّ يبدأ عند الثامنة والعشرين، فإن استغرق
 * خمساً وعشرين انتهى عند الثالثة والخمسين — دون السقف بفسحة.
 *
 * والشاشة تتابع وحدها حتى ينتهي الباقي، فلا يُطلَب من صاحب العمل أن
 * يضغط سبع مرّات ولا أن يعرف لماذا.
 */
const WALK_BUDGET_MS = 20_000;
const CONTENT_BUDGET_MS = 28_000;

interface Body {
  /** عدد الأشهر الأخيرة التي تُفحص. الافتراضي ثلاثة. */
  months?: number;
  /** أشهرٌ بعينها — بها يستأنف الطلبُ التالي ما أوقفته المهلة. */
  onlyMonths?: string[];
  /**
   * ملفّاتٌ بعينها — تُقرأ بمعرّفاتها بلا مشيٍ على الأرشيف.
   *
   * لأنّ قراءة ملفّين لا تستحقّ إعادةَ المشي على السنوات والأشهر
   * ومجلّدات المورّدين: عشرون ثانية تُهدَر قبل أن يُقرأ حرف، والدفعة
   * التالية تُهدرها ثانيةً. فالمشي مرّةً واحدة في الفحص، ثمّ تُقرأ
   * الملفّات بأسمائها من القائمة التي خرجت منه.
   */
  fileIds?: string[];
  /** فحص الأرشيف كله — أبطأ بكثير */
  full?: boolean;
  apply?: boolean;
  /** قراءة محتوى الملفات التي لا يُفهم اسمها */
  readContent?: boolean;
}

async function loadSuppliers(): Promise<SupplierRecord[]> {
  const rows = await db.select({
    id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
    driveFolderName: suppliers.driveFolderName, vatNumber: suppliers.vatNumber,
    issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile,
  }).from(suppliers).where(eq(suppliers.isActive, true));

  const ids = rows.map((r) => r.id);
  const aliasRows = ids.length
    ? await db.select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
        .from(supplierAliases).where(inArray(supplierAliases.supplierId, ids))
    : [];

  return rows.map((r) => ({
    ...r,
    aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
  }));
}

async function handle(request: Request) {
  let user;
  try {
    user = await guard("drive-sync", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const apply = body.apply === true;

  /* من الحارس وحده: وضعُ التجربة لا يستعير تفويض المالك (drive.service.ts) */
  const token = await refreshTokenFor(user.id);

  if (!token) {
    return NextResponse.json(
      { error: "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف." },
      { status: 428 },
    );
  }

  const drive = driveForUser(token);

  const known = new Set(
    (await db.select({ id: documents.driveFileId }).from(documents))
      .map((d) => d.id)
      .filter((v): v is string => Boolean(v)),
  );

  const months = Array.isArray(body.onlyMonths) && body.onlyMonths.length > 0
    ? body.onlyMonths.slice(0, 36)
    : body.full ? undefined : recentMonths(Math.max(1, Math.min(24, body.months ?? 3)));

  /*
    مهلةٌ دون سقف المزوّد.

    كان الطلب يُقتَل عند الستّين ثانية، فيردّ المزوّد نصّاً لا JSON،
    فتنفجر الشاشة برسالة «Unexpected token 'A'» — ولا أحد يعرف أنّ
    السبب مهلةٌ لا عطب. والوقوف المعلَن أصدق من قتلٍ صامت.
  */
  const startedAt = Date.now();
  const deadline = startedAt + WALK_BUDGET_MS;

  let fresh: ArchiveEntry[];
  let pendingMonths: string[] = [];
  let truncated = false;

  const direct = Array.isArray(body.fileIds) ? body.fileIds.slice(0, 8) : [];

  if (direct.length > 0) {
    /*
      ── قراءةٌ بالمعرّف: بلا مشي ──

      يُسأل عن الملفّ نفسه، ثمّ عن مجلّده وجدّه — ثلاثةُ نداءات لا
      عشرات. والشهرُ واسمُ المجلّد يُقرآن من الدرايف لا ممّا أرسله
      المتصفّح: من أرسل معرّفاً لا يُملي علينا أين هو.
    */
    const entries: ArchiveEntry[] = [];
    try {
    for (const id of direct) {
      /* ما هو مسجَّل لا يُقرأ ثانيةً — استخراجٌ بلا سبب */
      if (known.has(id)) continue;
      const file = await getFileMeta(drive, id);
      if (!file) continue;
      const folder = file.parents?.[0] ? await getFileMeta(drive, file.parents[0]) : null;
      const monthFolder = folder?.parents?.[0]
        ? await getFileMeta(drive, folder.parents[0])
        : null;
      if (!folder || !monthFolder || !/^\d{4}-\d{2}$/.test(monthFolder.name)) continue;
      entries.push({ month: monthFolder.name, folderName: folder.name, file });
    }
    } catch (e) {
      if (e instanceof DriveAuthExpiredError) {
        return NextResponse.json({ error: e.message }, { status: 428 });
      }
      throw e;
    }
    fresh = entries;
  } else {
    try {
      const walked = await walkArchive(drive, { months, knownFileIds: known, deadline });
      fresh = walked.entries;
      pendingMonths = walked.pendingMonths;
      truncated = walked.truncated;
    } catch (e) {
      /* التفويض المنتهي خبرٌ يُصلحه صاحبه — لا «لا جديد» ولا عطبٌ مبهم */
      if (e instanceof DriveAuthExpiredError) {
        return NextResponse.json({ error: e.message }, { status: 428 });
      }
      return NextResponse.json(
        { error: `تعذّرت قراءة الدرايف: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  }

  /** ما سُجّل في هذا الطلب — به يُسأل عن تسميته بعد قراءته. */
  const recordedFileIds = new Set<string>();

  const supplierList = await loadSuppliers();
  const bySlug = new Map(supplierList.map((s) => [s.slug, s]));
  const byFolder = new Map(supplierList.map((s) => [s.driveFolderName.trim(), s]));

  const named: { entry: ArchiveEntry; parsed: ReturnType<typeof parseFileName> }[] = [];
  const unnamed: ArchiveEntry[] = [];

  for (const entry of fresh) {
    const parsed = parseFileName(entry.file.name, KNOWN_SLUGS);
    if (parsed.ok) named.push({ entry, parsed });
    else unnamed.push(entry);
  }

  const scanned = {
    scope: direct.length > 0
      ? countNoun(direct.length, FILE)
      : months ? `${countNoun(months.length, MONTH)}` : "الأرشيف كله",
    /** أشهرٌ لم يُمشَ عليها — يكملها الطلب التالي بلا أن يُعيد ما مضى. */
    pendingMonths,
    truncated,
    knownBefore: known.size,
    newFiles: fresh.length,
    understoodByName: named.length,
    needContentReading: unnamed.length,
  };

  if (!apply) {
    return NextResponse.json({
      ok: true,
      applied: false,
      summary: scanned,
      files: fresh.slice(0, 40).map((e) => ({
        fileId: e.file.id,
        name: e.file.name,
        month: e.month,
        folder: e.folderName,
        understood: named.some((n) => n.entry.file.id === e.file.id),
      })),
    });
  }

  // ── التسجيل ──
  let created = 0;
  let invoicesCreated = 0;
  /** إيصالاتٌ وُجدت واقعتُها مقيَّدةً — عُلِّقت ولم تُنسَخ دفعةً ثانية. */
  let paymentsAdopted = 0;
  /** ملفّاتٌ شهرُها مقفل — تُعرَض ولا تُسجَّل حتى يُفتَح. */
  let closedMonthSkipped = 0;
  const notes: string[] = [];

  for (const { entry, parsed } of named.slice(0, MAX_NAMED_PER_CALL)) {
    if (!parsed.ok) continue;
    const p = parsed.value;
    const supplier = p.slug ? bySlug.get(p.slug) : byFolder.get(entry.folderName.trim());
    const plan = planImport(p, Boolean(supplier));
    for (const n of plan.notes) notes.push(`${entry.file.name} — ${n}`);

    const date = new Date(`${p.date}T00:00:00Z`);

    /*
      ── الشهر المقفل يُتخطّى برسالة، لا ٥٠٠ ──

      الكتابةُ عبر الخدمات (`createInvoice` و`createPayment`) وهي تسأل عن
      الإقفال قبل أن تكتب. فإن رمت رُدّت المعاملة كلّها — المستندُ معها —
      فيُعاد عرضُه في المزامنة التالية بعد فتح الشهر، ولا يبقى مستندٌ مؤرشف
      بلا فاتورته. وكان المسار يُدرج بيده فيصل إلى مؤثِّر ٠٢٨ بخطأ قاعدةٍ
      يقطع حلقة المزامنة كلّها.
    */
    /* تُعدّ بعد نجاح المعاملة — ما رُدّ لم يُسجَّل */
    let done = { doc: false, invoice: false, adopted: false };
    try {
    await db.transaction(async (tx) => {
      const [doc] = await tx.insert(documents).values({
        driveFileId: entry.file.id,
        driveFolderId: entry.file.parents?.[0] ?? null,
        fileName: entry.file.name,
        mimeType: entry.file.mimeType,
        sizeBytes: entry.file.size ?? null,
        /* لا تنزيل هنا فلا `sha256` — وبصمةُ الدرايف تكفي لمعرفته إن رُفع ثانيةً */
        driveMd5: entry.file.md5Checksum ?? null,
        kind: plan.documentKind as never,
        status: "ARCHIVED",
        periodMonth: entry.month,
        supplierId: supplier?.id ?? null,
        uploadedById: user.id,
      }).onConflictDoNothing().returning({ id: documents.id });

      if (!doc) return; // سُجّل بين الفحص والكتابة — لا نكرّره
      done = { ...done, doc: true };

      if (plan.createsInvoice && supplier) {
        const invoiceId = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: p.invoiceNumber!,
          invoiceDate: date,
          periodMonth: entry.month,
          /* الاسم يعطي الإجماليّ وحده — الصافي والضريبة مجهولان لا صفر */
          subtotalMinor: null,
          vatMinor: null,
          totalMinor: p.amountMinor!,
          /* ولا يُعرَف من الاسم أصالحةٌ ضريبياً — فالمجهول يُعلَن */
          taxStatus: "UNKNOWN",
          inputVatStatus: "UNKNOWN",
          isFixedAsset: false,
        });
        if (invoiceId) done = { ...done, invoice: true };
      }

      if (plan.createsStatement && supplier) {
        await tx.insert(statements).values({
          documentId: doc.id,
          supplierId: supplier.id,
          periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
          periodEnd: date,
          /* الرصيد الذي لم يُقرأ من الاسم يبقى مجهولاً — ويُملأ عند المطابقة */
          closingBalanceMinor: p.amountMinor ?? null,
        });
      }

      if (plan.createsPayment) {
        /*
          الإيصالُ **دليلٌ على دفعة**، لا دفعةٌ ثانية.

          كان هذا المسار يُدرج دفعةً بلا أن يسأل: أعندنا هذه الواقعة
          أصلاً؟ وحركةُ الكشف تُدرج أخرى، فيصير الريالُ ريالين. وفي
          قاعدة أحمد أربع كذلك — منها إيصال أفال ٨٬٤٠٢٫٧٧ وإيصال بيكوف
          ٩٠٠ — تُظهر المورّدَ مدفوعاً له ضعفَ ما أخذ.

          فإن وُجدت الواقعةُ مقيَّدةً بلا مستند، عُلِّق عليها الإيصالُ
          ولم تُنسَخ. وإن كانت لها مستندٌ آخر فهما إيصالان لواقعةٍ
          واحدة — يُسجَّل المستند ولا تُقيَّد دفعة، ويُترَك الأمر
          لفحص الازدواج.
        */
        /*
          والسؤالُ في `createPayment` نفسها لا منسوخاً هنا: كان هذا المسار
          يسأل `findPaymentTwin` بيده، فأوّلُ تغييرٍ في سياسة التوأم لا
          يبلغه. فيُنشئ عبر الخدمة، وإن ردّت بتوأمٍ تبنّاه.
        */
        try {
          await createPayment(tx, {
            documentId: doc.id,
            supplierId: supplier?.id ?? null,
            paidAt: date,
            amountMinor: p.amountMinor!,
            method: plan.paymentMethod,
            beneficiaryNameRaw: p.beneficiary ?? null,
            appliesToMonth: entry.month,
          });
        } catch (e) {
          if (!(e instanceof PaymentTwinError)) throw e;
          /* الرميُ قبل أيّ كتابة — فالمعاملة سليمةٌ تُكمَل */
          if (e.twin.documentId === null) {
            await tx.update(payments)
              .set({ documentId: doc.id })
              .where(eq(payments.id, e.twin.id));
          }
          done = { ...done, adopted: true };
        }
      }
    });
    if (done.doc) { created++; recordedFileIds.add(entry.file.id); }
    if (done.invoice) invoicesCreated++;
    if (done.adopted) paymentsAdopted++;
    } catch (e) {
      if (!(e instanceof MonthClosedError)) throw e;
      notes.push(`${entry.file.name} — لم يُسجَّل: ${e.message}`);
      closedMonthSkipped++;
    }
  }

  // ── الملفات التي لا يُفهم اسمها: تُقرأ بمحتواها ──
  let read = 0;
  let autoArchived = 0;
  const reviewGaps = new Map<AutoArchiveGap, number>();
  const readFailures: string[] = [];
  /** التسعيرات: تُعرَض ولا تُقيَّد. */
  const quotations: string[] = [];

  if (body.readContent) {
    try {
      await consume("drive-sync-content", user.id);
    } catch (e) {
      const mapped = respondTo(e);
      if (mapped) return mapped;
      throw e;
    }

    for (const entry of unnamed.slice(0, MAX_CONTENT_PER_CALL)) {
      /*
        الوقوف قبل بدء ملفٍّ لا في وسطه: الاستخراج يستغرق ما يستغرق،
        وقطعُه في منتصفه يترك ملفّاً نُزّل ولم يُقيَّد. فيُسأل الوقتُ
        عند الباب، ومن دخل أُتِمّ له.
      */
      if (Date.now() - startedAt >= CONTENT_BUDGET_MS) break;

      /*
        والشهرُ يُسأل عند الباب أيضاً — قبل التنزيل والقراءة. فالقراءةُ
        نداءٌ مدفوع، وكتابتُها في شهرٍ مقفل تُرَدّ فيضيع ثمنُها ويُعاد في
        كلّ مزامنة. والخدمة تسأل ثانيةً وقت الكتابة.
      */
      const closed = await firstClosedMonth(db, [entry.month]);
      if (closed) {
        notes.push(`${entry.file.name} — لم يُقرأ: ${new MonthClosedError(closed).message}`);
        closedMonthSkipped++;
        continue;
      }

      let data: Buffer;
      let mimeType: string;
      try {
        ({ data, mimeType } = await downloadFile(drive, entry.file.id));
      } catch (e) {
        if (isDriveAuthError(e)) {
          return NextResponse.json({ error: new DriveAuthExpiredError().message }, { status: 428 });
        }
        readFailures.push(`${entry.file.name} — تعذّر التنزيل`);
        continue;
      }

      const extraction = await extractDocument({
        data, mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      });

      if (!extraction.ok) {
        readFailures.push(`${entry.file.name} — ${extraction.reason}`);
        continue;
      }

      const x = extraction.value;

      /*
        ── التسعيرة تُحذَّر ولا تُسجَّل ──

        عرضُ السعر ليس واقعةً ماليّة: لا مالَ خرج ولا التزامَ نشأ، وقد
        يُلغى أو يتغيّر سعرُه قبل أن يصير فاتورة. وتقييدُه يُدخل في
        الأرشيف رقماً يبدو مستحقّاً وليس كذلك.

        فيُعلَن ولا يُقيَّد — ويبقى في الدرايف كما هو، فإن صار فاتورةً
        سُجّلت الفاتورة.
      */
      if (x.documentKind === "QUOTATION") {
        quotations.push(`${entry.file.name} — عرض سعر، لم يُسجَّل`);
        continue;
      }

      const folderSupplier = byFolder.get(entry.folderName.trim());
      const matched = matchSupplier(supplierList, {
        sellerVatNumber: x.sellerVatNumber,
        supplierNameAr: x.supplierNameAr,
        supplierNameEn: x.supplierNameEn,
      });
      const supplier = folderSupplier ?? matched.supplier;

      const review = reviewConfirmed(
        {
          documentKind: x.documentKind,
          supplierId: supplier?.id,
          invoiceNumber: x.invoiceNumber,
          invoiceDate: x.invoiceDate,
          subtotalMinor: parseRiyals(x.subtotalAmount),
          vatMinor: parseRiyals(x.vatAmount),
          totalMinor: parseRiyals(x.totalAmount),
          sellerVat: x.sellerVatNumber,
          buyerVat: x.buyerVatNumber,
        },
        {
          companyVat: companyConfig.vatNumber,
          supplierIssuesInvoices: supplier?.issuesInvoices,
          supplierContractOnFile: supplier?.contractOnFile,
        },
      );

      /*
        ── أيدخل وحده؟ ── (`auto-archive.ts`، بإذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

        أربعةُ شروطٍ معاً: نصٌّ مكتوب لا صورة، ورقمٌ ضريبيّ يطابق المورّد،
        وحسابٌ مستقيم، ومورّدٌ معروف. وما لم تجتمع فيه ينتظر إنساناً،
        ولوحُ المراجعة يقول له أيُّها لم يتحقّق.
      */
      const sellerDigits = (x.sellerVatNumber ?? "").replace(/\D/g, "");
      const verdict = autoArchive({
        kind: x.documentKind,
        invoiceRecorded: review.canCreateInvoice && Boolean(supplier) && parseRiyals(x.totalAmount) !== null,
        textSource: extraction.textSource ?? null,
        supplierKnown: Boolean(supplier),
        sellerVat: x.sellerVatNumber ?? null,
        supplierVat: supplier?.vatNumber ?? null,
        subtotalMinor: parseRiyals(x.subtotalAmount),
        vatMinor: parseRiyals(x.vatAmount),
        totalMinor: parseRiyals(x.totalAmount),
        supplierByFolder: Boolean(folderSupplier) && supplier === folderSupplier,
        vatTakenByOther: sellerDigits !== "" && supplierList.some(
          (s) => s.id !== supplier?.id && (s.vatNumber ?? "").replace(/\D/g, "") === sellerDigits,
        ),
      });

      /*
        ── المزامنة لا تسمّي شيئاً قبل التقييد ──

        كانت تعيد تسمية الملفّ في الدرايف قبل تقييده، بلا اختيارٍ لكلّ
        ملفّ ولا أثرٍ في سجلّ التدقيق، والاسم الأصليّ لا يُحفَظ في موضع —
        فضاع اسمٌ كتبه مورّد (لوريفا)، واستُبدل رقمٌ كتبه إنسان بقراءةٍ
        خاطئة (غاناش). وهذا خرقٌ للقيد الأوّل نصّاً: «لا شيء بلا اختيار
        الإنسان ملفّاً ملفّاً وأثرٍ في سجلّ التدقيق».

        فيُقيَّد الملفّ باسمه كما هو، ثمّ — بعد التقييد — يُسمّى آلياً ما
        أُرشِف (`drive-rename.service.ts`، بالاسمين في السجلّ)، ويُقترَح
        ما سواه في الردّ (`renameSuggestions`).
      */
      const finalName = entry.file.name;

      /* تُعدّ بعد نجاح المعاملة — ما رُدّ لم يُسجَّل ولم يُقرأ */
      let recorded = false;
      let invoiceCreated = false;
      try {
      await db.transaction(async (tx) => {
        const [doc] = await tx.insert(documents).values({
          driveFileId: entry.file.id,
          driveFolderId: entry.file.parents?.[0] ?? null,
          fileName: finalName,
          mimeType,
          sizeBytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          driveMd5: entry.file.md5Checksum ?? createHash("md5").update(data).digest("hex"),
          kind: x.documentKind as never,
          /*
            ما قرأه النموذج ينتظر إنساناً إلّا إن اجتمعت الشروطُ الأربعة:
            كان يُقيَّد «مؤرشفاً» بلا شرط فيدخل ملفّ التحويلات وما رآه أحد —
            وفاتورةٌ منفوخة حسابُها مستقيم تمرّ كلَّ فحص. والشرطان اللذان
            يسدّان ذلك: نصٌّ منقول لا صورةٌ مقروءة، ورقمٌ ضريبيّ يطابق المورّد.
          */
          status: verdict.auto ? "ARCHIVED" : "NEEDS_REVIEW",
          periodMonth: entry.month,
          supplierId: supplier?.id ?? null,
          extractionJson: x as never,
          extractionModel: extraction.model,
          textSource: extraction.textSource ?? null,
          fieldConfidence: x.confidence as never,
          uploadedById: user.id,
        }).onConflictDoNothing().returning({ id: documents.id });

        if (!doc) return;
        recorded = true;

        /* رقمٌ ضريبيّ تُعُلِّم لمورّدٍ لا رقمَ له — يُكتَب إن بقي فارغاً */
        if (verdict.learnVat && supplier) {
          await tx.update(suppliers)
            .set({ vatNumber: verdict.learnVat })
            .where(and(eq(suppliers.id, supplier.id), isNull(suppliers.vatNumber)));
        }

        if (!review.canCreateInvoice || !supplier) return;

        const totalMinor = parseRiyals(x.totalAmount)!;
        const invoiceDate = new Date(`${x.invoiceDate}T00:00:00Z`);
        /*
          عبر `createInvoice` و`replaceLines` لا إدراجاً باليد: فيُحرَس
          الشهر المقفل، وتُسوّى البنود بالحساب نفسه الذي يمرّ به الرفع —
          ثلاثةُ مساراتٍ تُنشئ فواتير، وافتراقُها في السعر أنتج «ارتفاعاً» لم يقع.
        */
        const invoiceId = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: x.invoiceNumber.trim(),
          invoiceDate,
          periodMonth: entry.month || x.invoiceDate.slice(0, 7),
          // الفراغ يبقى فراغاً — المجهول لا يصير صفراً
          subtotalMinor: parseRiyals(x.subtotalAmount),
          vatMinor: parseRiyals(x.vatAmount),
          totalMinor,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        });

        if (!invoiceId) return;
        invoiceCreated = true;

        await replaceLines(tx, {
          invoiceId,
          supplierId: supplier.id,
          invoiceDate,
          subtotalMinor: parseRiyals(x.subtotalAmount),
          lines: x.lines,
        });

        /* مالٌ دُفع لهذا المورّد قبل وصول فاتورته يُخصم منها — كما في الرفع */
        await applySupplierCredit(tx, supplier.id, { forwardDays: SETTLEMENT_FORWARD_DAYS });
      });
      if (recorded) {
        created++; read++; recordedFileIds.add(entry.file.id);
        if (verdict.auto) autoArchived++;
        else for (const g of verdict.gaps) reviewGaps.set(g, (reviewGaps.get(g) ?? 0) + 1);
        /* فواتيرُ المورّد التالية في هذا النداء تُقابَل بالرقم الذي تُعُلِّم */
        if (verdict.learnVat && supplier && !supplier.vatNumber) supplier.vatNumber = verdict.learnVat;
      }
      if (invoiceCreated) invoicesCreated++;
      } catch (e) {
        /* أُقفل الشهر بين السؤال عند الباب والكتابة — يُتخطّى برسالة */
        if (!(e instanceof MonthClosedError)) throw e;
        notes.push(`${entry.file.name} — لم يُسجَّل: ${e.message}`);
        closedMonthSkipped++;
      }
    }
  }

  const remaining = Math.max(0, unnamed.length - read);

  if (created > 0) {
    await recordAudit({
      actorId: user.id,
      action: "DRIVE_SYNCED",
      entityType: "drive_sync",
      entityId: new Date().toISOString(),
      after: {
        النطاق: scanned.scope,
        ملفات_جديدة: fresh.length,
        سُجّلت: created,
        فواتير: invoicesCreated,
        "إيصالات عُلِّقت على دفعةٍ قائمة": paymentsAdopted,
        قُرئ_محتواها: read,
      },
    });
  }

  /*
    ── وما سُجّل للتوّ: أيُّه اسمُه خارج الصيغة؟ ──

    وهذا موضعُ السؤال الطبيعيّ. الملفّ الذي رفعه المورّد باسمه —
    «فاتورة - 260351 - مؤسسة ذا بوبليك هاوس.pdf» — يُكتشَف هنا، ويُقرأ
    محتواه هنا، فيُعرَف مورّدُه وتاريخُه وإجماليُّه **هنا**. فسؤالُ
    «أأوحّد اسمَه؟» يقع في هذه اللحظة لا في شاشةٍ أخرى.

    وكان يقع في شاشةٍ أخرى: فحصُ التسمية ينظر إلى المسجَّل، والملفّ
    الجديد لم يُسجَّل بعد — فيراه أحمد في المزامنة «اسمُه غلط» ويراه
    الفحصُ «لا شيء». خيطان لا يلتقيان، والعمل بينهما يضيع.

    ولا يُعاد تسميةُ شيء هنا: يُقترَح وحسب، والفعلُ في `/api/drive-rename`
    باختيارٍ ملفّاً ملفّاً.
  */
  const justRecorded = [...recordedFileIds];

  /*
    ── التسميةُ الآليّة ── (إذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

    ما أُرشِف للتوّ ويخالف اسمُه الصيغة يُسمّى الآن، بأثرٍ في السجلّ
    بالاسمين. وما ينتظر المراجعة لا يُسمّى — اسمُه يُبنى من قيدٍ لم يُحسَم —
    ويُسمّى حين يُعتمَد. وما لا يُبنى له اسمٌ يبقى اقتراحاً أو سبباً.
    والكتابةُ على الدرايف في الإنتاج وحده، وفي غيره تبقى اقتراحاً.
  */
  let renamed: { from: string; to: string }[] = [];
  const renameFailures: string[] = [];
  if (justRecorded.length > 0 && driveWritesAllowed(process.env)) {
    const outcome = await renameArchived(drive, justRecorded, user.id, "المزامنة");
    renamed = outcome.done;
    renameFailures.push(...outcome.failed.map((f) => `${f.from} — ${f.error}`));
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  const renameSuggestions: { fileId: string; current: string; proposed: string }[] = [];

  if (justRecorded.length > 0) {
    const rows = await db
      .select({
        driveFileId: documents.driveFileId,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        kind: documents.kind,
        slug: suppliers.slug,
        invoiceDate: invoices.invoiceDate,
        invoiceTotal: invoices.totalMinor,
        invoiceNumber: invoices.invoiceNumber,
        statementEnd: statements.periodEnd,
        statementTotal: statements.closingBalanceMinor,
      })
      .from(documents)
      .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
      .leftJoin(invoices, eq(invoices.documentId, documents.id))
      .leftJoin(statements, eq(statements.documentId, documents.id))
      .where(inArray(documents.driveFileId, justRecorded));

    for (const r of rows) {
      if (!r.driveFileId || renamedFrom.has(r.fileName)) continue;
      const verdict = canonicalName({
        driveFileId: r.driveFileId,
        fileName: r.fileName,
        mimeType: r.mimeType,
        kind: r.kind,
        slug: r.slug,
        date: (r.invoiceDate ?? r.statementEnd)?.toISOString().slice(0, 10) ?? null,
        totalMinor: r.invoiceTotal ?? r.statementTotal ?? null,
        invoiceNumber: r.invoiceNumber ?? null,
      });
      if (verdict.status === "RENAME") {
        renameSuggestions.push({
          fileId: r.driveFileId, current: r.fileName, proposed: verdict.proposed,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    applied: true,
    summary: {
      ...scanned, created, invoicesCreated, paymentsAdopted, closedMonthSkipped, contentRead: read, remainingUnnamed: remaining,
      autoArchived, needsReview: read - autoArchived, renamed: renamed.length,
    },
    /* لماذا لم يدخل ما لم يدخل — مجموعاً بالسبب، فيُعرَف أيُّ شرطٍ يُسقط أكثر */
    reviewReasons: [...reviewGaps.entries()].map(([gap, count]) => ({ gap, count })),
    renamed,
    renameFailures,
    notes: notes.slice(0, 20),
    readFailures,
    quotations,
    renameSuggestions,
  });
}

/* النداءات تحت عمر المسار — تقف بمهلةٍ معلَنة قبل أن تقتلها المنصّة */
export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}
