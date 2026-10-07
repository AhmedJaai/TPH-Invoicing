/**
 * خدمة المورّدين: التحميل والسياق والإنشاء.
 *
 * سياق المورّد جزء من الفحص الضريبي — المورّد الذي لا يصدر فواتير أصلاً
 * لا يُطالَب بما لا يملك، والذي بلا عقد يُنبَّه عليه. فجمعُ ذلك في مكان
 * واحد يمنع أن يفحص كل مسار بقواعد مختلفة.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplierAliases, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { resolveNewSupplierName } from "@/lib/supplier-match";
import { normalizeName } from "@/lib/suppliers-seed";
import type { Tx } from "./types";

export interface SupplierContext {
  id: string;
  nameAr: string;
  issuesInvoices: boolean;
  contractOnFile: boolean;
}

/** سياق مورّد بعينه، أو null إن لم يوجد. */
export async function supplierContext(id: string | null | undefined): Promise<SupplierContext | null> {
  if (!id) return null;
  const [row] = await db
    .select({
      id: suppliers.id,
      nameAr: suppliers.nameAr,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  return row ?? null;
}

/** رمز لاتيني قصير لاسم الملف؛ العربي يُشتقّ له رمز مميَّز. */
const ARABIC_TO_LATIN: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
  "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
  "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a",
  "و": "w", "ي": "y", "ى": "a", "ؤ": "w", "ئ": "y", "ء": "",
};
/** كلماتٌ لا تميّز مورّداً — «شركة» و«مؤسسة» في كلّ اسم */
const GENERIC_WORDS = new Set(["شركة", "مؤسسة", "للتجارة", "التجارية", "المحدودة", "مصنع", "محل"]);

/** «شركة جملة تقنية للتجارة» ← «JmlaTqnya» — كلمتان مميِّزتان بحروفٍ لاتينيّة */
export function transliterateName(nameAr: string): string {
  return nameAr
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .split(/[\s—\-–()]+/)
    .filter((w) => w && !GENERIC_WORDS.has(w))
    .slice(0, 2)
    .map((w) => [...w].map((c) => ARABIC_TO_LATIN[c] ?? (/[A-Za-z0-9]/.test(c) ? c : "")).join(""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function deriveSlug(nameEn: string | undefined, nameAr: string): string {
  const latin = (nameEn ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

  if (latin.length >= 2) return latin.slice(0, 32);

  /*
    بلا اسمٍ إنجليزيّ يُكتب العربيُّ بحروفٍ لاتينيّة — كان يصير رمزاً («SUPSL2F0X» لفودكس)
    يدخل أسماءَ ملفّات الأرشيف فلا يُقرأ منها المورّد.
  */
  const roman = transliterateName(nameAr);
  if (roman.length >= 3) return roman.slice(0, 32);

  const digest = [...normalizeName(nameAr)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `SUP${digest.toString(36).toUpperCase().slice(0, 6)}`;
}

export interface CreateSupplierInput {
  nameAr: string;
  nameEn?: string;
  driveFolderName?: string;
  vatNumber?: string;
  /** رأى المستخدمُ من يشبهونه وقال «هو غيرُهم» — يُنشأ ولا يُسأل ثانيةً. */
  confirmNew?: boolean;
}

export interface SupplierLite {
  id: string;
  nameAr: string;
  slug: string;
}

export type CreateSupplierOutcome =
  | ({ kind: "created" } & SupplierLite)
  /** هو نفسُه — بالاسم، أو بالرقم الضريبيّ (`by: "VAT"`: الرقمُ لمورّدٍ باسمٍ آخر) */
  | ({ kind: "existed"; by: "NAME" | "VAT" } & SupplierLite)
  /** يشبه مسجَّلين — لم يُنشأ شيء، ويقرّر الإنسان */
  | { kind: "similar"; similar: SupplierLite[] };

const digits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

/**
 * ينشئ مورّداً، أو يرجع الموجود، أو يسأل «أتقصد فلاناً؟».
 * الإرجاع بدل الإنشاء مقصود: صفّان لمورّد واحد يقسمان بياناته — كشفه هنا
 * وفواتيره هناك — وقد رأينا ذلك يُنتج «عشر فواتير ناقصة» وهي عندنا.
 *
 * في معاملةٍ واحدة بقفل: كان فحصاً ثمّ إدراجاً بلا معاملة، فطلبان متزامنان
 * يُنشئان مورّدين. والرقمُ الضريبيّ يُسأل عنه **أوّلاً** — هو الهويّة — فرقمٌ
 * مسجَّلٌ لمورّدٍ آخر يُرجعه باسمه بدل أن يصطدم بفرادة العمود خطأً خامّاً.
 * والرمزُ يُجرَّب حتّى يخلو (كان يُلحَق به «2» مرّةً واحدة). والتدقيقُ في
 * المعاملة نفسها.
 */
export async function createSupplier(input: CreateSupplierInput, actorId: string | null): Promise<CreateSupplierOutcome> {
  const nameAr = input.nameAr.trim();
  const nameEn = input.nameEn?.trim() || undefined;
  const normalized = normalizeName(nameAr);
  const vat = digits(input.vatNumber);

  return db.transaction(async (t) => {
    await t.execute(sql`select pg_advisory_xact_lock(hashtext('supplier-create'))`);

    const rows = await t
      .select({
        id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
        driveFolderName: suppliers.driveFolderName, vatNumber: suppliers.vatNumber,
        issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile,
        isActive: suppliers.isActive,
      })
      .from(suppliers);
    const aliasRows = await t
      .select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
      .from(supplierAliases);
    const all = rows.map((r) => ({
      ...r,
      aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
    }));

    if (vat) {
      const byVat = all.find((s) => digits(s.vatNumber) === vat);
      if (byVat) return { kind: "existed", by: "VAT", id: byVat.id, nameAr: byVat.nameAr, slug: byVat.slug };
    }

    /* المعطَّلُ بالدمج لا يُقترَح ولا يُرجَع — لكنّ اسمَه بنصّه ما زال محجوزاً له */
    const exact = all.find((s) => s.nameAr === nameAr || s.driveFolderName === nameAr);
    if (exact) return { kind: "existed", by: "NAME", id: exact.id, nameAr: exact.nameAr, slug: exact.slug };

    const resolved = resolveNewSupplierName(all.filter((s) => s.isActive), { nameAr, nameEn });
    if ("same" in resolved) {
      return { kind: "existed", by: "NAME", id: resolved.same.id, nameAr: resolved.same.nameAr, slug: resolved.same.slug };
    }
    if (resolved.similar.length > 0 && !input.confirmNew) {
      return { kind: "similar", similar: resolved.similar.map((s) => ({ id: s.id, nameAr: s.nameAr, slug: s.slug })) };
    }

    const base = deriveSlug(nameEn, nameAr);
    const taken = new Set(all.map((s) => s.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 30)}${n}`;

    const [created] = await t
      .insert(suppliers)
      .values({
        slug,
        driveFolderName: input.driveFolderName?.trim() || nameAr,
        nameAr,
        nameEn: nameEn ?? null,
        vatNumber: vat || null,
      })
      .returning({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug });

    await t
      .insert(supplierAliases)
      .values({ supplierId: created.id, value: nameAr, normalized, kind: "NAME_VARIANT", source: "MANUAL" })
      .onConflictDoNothing();

    await recordAudit({
      actorId,
      action: "SUPPLIER_CREATED",
      entityType: "supplier",
      entityId: created.id,
      after: {
        الاسم: nameAr,
        الرمز: slug,
        "مجلد الدرايف": input.driveFolderName?.trim() || nameAr,
        ...(vat ? { "الرقم الضريبي": vat } : {}),
        ...(resolved.similar.length > 0 ? { "أُنشئ مع وجود من يشبهه": resolved.similar.map((s) => s.nameAr) } : {}),
      },
    }, t);

    return { kind: "created", ...created };
  });
}

/**
 * يحفظ اسماً بنكياً للمورّد — يُطابَق به مستقبلاً.
 *
 * والاسم القصير يطابق الجميع فيفسد المطابقة كلّها: ثلاثة أحرف بعد
 * التطبيع حدٌّ أدنى، وما دونه يُرَدّ `false` ولا يُحفَظ.
 */
export const MIN_ALIAS_LENGTH = 3;

export async function learnAlias(
  tx: Tx | typeof db,
  supplierId: string,
  value: string,
): Promise<boolean> {
  if (normalizeName(value).length < MIN_ALIAS_LENGTH) return false;
  await tx
    .insert(supplierAliases)
    .values({
      supplierId,
      value,
      normalized: normalizeName(value),
      kind: "BANK_BENEFICIARY",
      source: "LEARNED",
    })
    .onConflictDoNothing();
  return true;
}
