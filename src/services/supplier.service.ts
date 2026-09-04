/**
 * خدمة المورّدين: التحميل والسياق والإنشاء.
 *
 * سياق المورّد جزء من الفحص الضريبي — المورّد الذي لا يصدر فواتير أصلاً
 * لا يُطالَب بما لا يملك، والذي بلا عقد يُنبَّه عليه. فجمعُ ذلك في مكان
 * واحد يمنع أن يفحص كل مسار بقواعد مختلفة.
 */
import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { supplierAliases, suppliers } from "@/db/schema";
import type { SupplierRecord } from "@/lib/supplier-match";
import { normalizeName } from "@/lib/suppliers-seed";
import type { Tx } from "./types";

export interface SupplierContext {
  id: string;
  nameAr: string;
  issuesInvoices: boolean;
  contractOnFile: boolean;
}

/** كل المورّدين النشطين مع أسمائهم البديلة — ما تحتاجه المطابقة. */
export async function loadActiveSuppliers(): Promise<SupplierRecord[]> {
  const rows = await db
    .select({
      id: suppliers.id,
      slug: suppliers.slug,
      nameAr: suppliers.nameAr,
      nameEn: suppliers.nameEn,
      driveFolderName: suppliers.driveFolderName,
      vatNumber: suppliers.vatNumber,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true));

  const ids = rows.map((r) => r.id);
  const aliasRows = ids.length
    ? await db
        .select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
        .from(supplierAliases)
        .where(inArray(supplierAliases.supplierId, ids))
    : [];

  return rows.map((r) => ({
    ...r,
    aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
  }));
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

  const digest = [...normalizeName(nameAr)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `SUP${digest.toString(36).toUpperCase().slice(0, 6)}`;
}

export interface CreateSupplierInput {
  nameAr: string;
  nameEn?: string;
  driveFolderName?: string;
  vatNumber?: string;
}

export interface CreatedSupplier {
  id: string;
  nameAr: string;
  slug: string;
  existed: boolean;
}

/**
 * ينشئ مورّداً، أو يرجع الموجود باسمه.
 * الإرجاع بدل الإنشاء مقصود: صفّان لمورّد واحد يقسمان بياناته — كشفه هنا
 * وفواتيره هناك — وقد رأينا ذلك يُنتج «عشر فواتير ناقصة» وهي عندنا.
 */
export async function createSupplier(input: CreateSupplierInput): Promise<CreatedSupplier> {
  const nameAr = input.nameAr.trim();
  const normalized = normalizeName(nameAr);

  const [existing] = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
    .from(suppliers)
    .where(or(eq(suppliers.nameAr, nameAr), eq(suppliers.driveFolderName, nameAr)))
    .limit(1);

  if (existing) return { ...existing, existed: true };

  let slug = deriveSlug(input.nameEn, nameAr);
  const taken = await db.select({ slug: suppliers.slug }).from(suppliers).where(eq(suppliers.slug, slug));
  if (taken.length > 0) slug = `${slug}2`;

  const [created] = await db
    .insert(suppliers)
    .values({
      slug,
      driveFolderName: input.driveFolderName?.trim() || nameAr,
      nameAr,
      nameEn: input.nameEn?.trim() || null,
      vatNumber: input.vatNumber?.trim() || null,
    })
    .returning({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug });

  await db
    .insert(supplierAliases)
    .values({ supplierId: created.id, value: nameAr, normalized, kind: "NAME_VARIANT", source: "MANUAL" })
    .onConflictDoNothing();

  return { ...created, existed: false };
}

/** يحفظ اسماً بنكياً للمورّد — يُطابَق به مستقبلاً. */
export async function learnAlias(
  tx: Tx | typeof db,
  supplierId: string,
  value: string,
): Promise<void> {
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
}
