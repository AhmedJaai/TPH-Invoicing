/**
 * العدُّ بعدّة خانات للصنف الواحد — كما في ورقة الجرد التي كان يرسلها أنس (أحمد، ٨ نوفمبر ٢٠٢٦):
 * «كرتون ١٩ + حبّة ٨٩٧»، «جرام ٥٠٠ + حبّة»، تُجمع في كمّيّةٍ واحدة بوحدة الصنف.
 *
 * الخاناتُ من عائلة وحدة الصنف (كيلو وجرام · لتر وملّل · حبّة) وفوقها **وحدةُ التخزين** من كتالوج
 * فودكس إن عُرف ما فيها (`catalog_pack_unit` · `catalog_pack_milli`: كرتونُ ٥٠٠ كاس). والجمعُ
 * في الخادم بأعدادٍ صحيحة، ولا جسرَ بين وزنٍ وحجم ولا كرتونٍ مجهولِ المحتوى.
 */
import { decimalToMilli, isAmbiguousThousands, ambiguousThousandsMessage, toCanonical, unitChoices } from "./units";
import { isStoredUnit, storedUnitLabel, type StoredUnit } from "../unit-conversion";

/** «STORAGE» وحدةُ التخزين من الكتالوج؛ وغيرُها وحدةٌ مخزَّنة من عائلة الصنف. */
export type PartKey = StoredUnit | "STORAGE";

export interface PartField { key: PartKey; label: string }

/** ما كتبه الموظّفُ كما كتبه — يُحفظ مع العدّ (`count_parts`) ويُعرض في التقرير. */
export interface CountPart { key: PartKey; label: string; quantity: string }

export interface StoragePack { label: string; milli: number }

/**
 * وحدةُ التخزين صالحةٌ للعدّ إن سُمّيت بغير وحدة الصنف ووسعت أكثر من وحدةٍ منه.
 * («G» بمعامل ١ ليست كرتوناً.)
 */
export function storagePack(baseUnit: StoredUnit, label: string | null, milli: number | null): StoragePack | null {
  const name = label?.trim() ?? "";
  if (!name || name === baseUnit || milli === null || !Number.isSafeInteger(milli) || milli <= 1000) return null;
  /* «كيلو» وحدةَ تخزينٍ للبنّ ليست وعاءً — خانتُها قائمةٌ في العائلة، فلا تُكرَّر */
  if (PLAIN_UNITS.has(plain(name))) return null;
  return { label: name, milli };
}

/** أسماءُ الوحدات نفسِها — لا أوعية — كما تُكتب في الكتالوج. */
const PLAIN_UNITS = new Set([
  "كيلو", "كيلوجرام", "كيلوغرام", "كجم", "كغ", "جرام", "غرام", "جم", "لتر", "مليلتر", "ملليلتر", "مل", "ملل", "حبة", "حبه",
  "kg", "kilo", "kilogram", "g", "gm", "gr", "gram", "l", "liter", "litre", "ml", "milliliter", "pc", "pcs", "piece", "pieces",
]);
const plain = (s: string) => s.replace(/[\u064B-\u0652]/g, "").toLowerCase().replace(/\.$/, "");

/** خاناتُ الصنف: وحدةُ التخزين أوّلاً (الأكبر)، ثمّ الأكبرُ فالأصغر من عائلته. */
export function partFields(baseUnit: StoredUnit, pack: StoragePack | null): PartField[] {
  const family = [...unitChoices(baseUnit)].reverse().map((u) => ({ key: u, label: storedUnitLabel(u) }));
  return pack ? [{ key: "STORAGE", label: pack.label }, ...family] : family;
}

/**
 * يجمع الخاناتِ كمّيّةً قانونيّة (`actual_milli`) — أو يقول لماذا لا.
 * كلُّها فارغة ← `null` («لم يُعَدّ»)، لا صفر. وصفرٌ مكتوبٌ صفرٌ بدليل.
 */
export function sumParts(
  parts: readonly { key: PartKey; quantity: string }[],
  baseUnit: StoredUnit,
  pack: StoragePack | null,
): { ok: true; canonical: number | null; parts: CountPart[] } | { ok: false; error: string } {
  const fields = partFields(baseUnit, pack);
  let total = BigInt(0);
  const kept: CountPart[] = [];
  for (const p of parts) {
    const raw = p.quantity.trim();
    if (raw === "") continue;
    const field = fields.find((f) => f.key === p.key);
    if (!field) return { ok: false, error: "وحدة لا تصلح لهذا الصنف. حدّث الصفحة." };
    if (isAmbiguousThousands(raw)) return { ok: false, error: ambiguousThousandsMessage(raw) };
    const milli = decimalToMilli(raw);
    if (milli === null || milli < 0) return { ok: false, error: `«${raw}» ليس رقماً. اكتب مثل 2 أو 0.5` };
    /* «0.032» في خانة الجرام كيلو كُتب في غير خانته — ولا يُعدّ في المقهى ما دون الجرام أو الملّل */
    if ((p.key === "G" || p.key === "ML") && milli > 0 && milli < 1000) {
      return { ok: false, error: `«${raw}» ${field.label} أقلّ من ${field.label} واحد. إن كان بال${p.key === "G" ? "كيلو فاكتبه في خانة الكيلو" : "لتر فاكتبه في خانة اللتر"}.` };
    }
    if (p.key === "STORAGE") {
      if (!pack) return { ok: false, error: "وحدة التخزين غير معروفة لهذا الصنف." };
      /* كراتين × ما في الكرتون، بالمِلّي — وكسرُ المِلّي يُقرَّب (جزءٌ من ألفٍ من الحبّة) */
      const inBase = (BigInt(milli) * BigInt(pack.milli) + BigInt(500)) / BigInt(1000);
      total += BigInt(toCanonical(Number(inBase), baseUnit));
    } else {
      total += BigInt(toCanonical(milli, p.key));
    }
    kept.push({ key: p.key, label: field.label, quantity: raw });
  }
  if (kept.length === 0) return { ok: true, canonical: null, parts: [] };
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "الكمية كبيرة جداً، فراجع عدد الأصفار" };
  return { ok: true, canonical: Number(total), parts: kept };
}

/** «١٩ كرتون + ٨٩٧ حبّة» — كما كتبه. */
export function partsText(parts: readonly CountPart[]): string {
  return parts.map((p) => `${p.quantity} ${p.label}`).join(" + ");
}

/** قراءةُ `count_parts` من القاعدة بفحصٍ لا بـ`as` — والتالفُ يُقرأ «لا تفصيل». */
export function readParts(value: unknown): CountPart[] | null {
  if (!Array.isArray(value)) return null;
  const out: CountPart[] = [];
  for (const v of value) {
    if (v && typeof v === "object" && "key" in v && "label" in v && "quantity" in v
      && typeof v.label === "string" && typeof v.quantity === "string") {
      const key: PartKey | null = v.key === "STORAGE" ? "STORAGE" : isStoredUnit(v.key) ? v.key : null;
      if (key) out.push({ key, label: v.label, quantity: v.quantity });
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * رقمٌ يستحقّ «تأكّد منه»: خمسةُ أضعاف آخر عدٍّ أو خُمسُه — صفرٌ زائد أو ناقص في الغالب.
 * يُسأل في الخادم ويُقال للموظّف اسمُ الصنف وحده، فيبقى العدُّ أعمى عن الرقم السابق.
 */
export function unusualCount(now: number | null, previous: number | null): boolean {
  if (now === null || previous === null || now <= 0 || previous <= 0) return false;
  return now >= previous * 5 || now * 5 <= previous;
}
