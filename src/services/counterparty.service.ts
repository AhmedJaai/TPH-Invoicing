/**
 * ذاكرة المستفيدين: تُقرأ وتُبنى.
 *
 * الفكرة كلّها في جملة: **يؤكّد الإنسان مرّةً، فيعمّ على أمثاله.**
 *
 * وحين يؤكّد أنّ حركةً بعينها لجهةٍ بعينها، لا يُحفَظ نصّ الوصف قاعدةً،
 * بل تُستخرَج من الحركة كلُّ الأدلّة الصالحة — الاسم والحساب والآيبان
 * ورقم الهوية ورقم التاجر — وتُنسَب إلى الجهة. فالمرّة القادمة تُعرَف
 * وإن تغيّرت صيغة الاسم، ما دام حسابها أو هويّتها هي.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { counterparties, counterpartyEvidence } from "@/db/schema";
import { createId } from "@/lib/id";
import { recordAudit } from "@/lib/audit";
import { normalizeText, type CanonicalTransaction } from "@/lib/bank/canonical";
import type { MerchantMemory } from "@/lib/bank/classification";
import type { TxCategory } from "@/lib/bank/rules";
import { fromCategory } from "@/lib/bank/apply";
import { isConflict, isExclusive } from "@/lib/bank/evidence-uniqueness";

export type { EvidenceKind } from "@/lib/bank/evidence-uniqueness";
import type { EvidenceKind } from "@/lib/bank/evidence-uniqueness";

export interface EvidenceItem {
  kind: EvidenceKind;
  value: string;
  normalized: string;
}

/**
 * كل ما يصلح دليلاً على الجهة في هذه الحركة.
 *
 * ولا يُؤخَذ المرجع البنكيّ دليلاً: هو رقم عمليةٍ يتغيّر كل مرّة، فحفظه
 * يُنتج ذاكرةً لا تُطابِق شيئاً بعده.
 */
export function evidenceFrom(tx: CanonicalTransaction): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const seen = new Set<string>();

  const push = (kind: EvidenceKind, value: string) => {
    const normalized = normalizeText(value).toUpperCase();
    if (normalized.length < 3) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, normalized });
  };

  for (const r of tx.references) {
    if (r.kind === "ACCOUNT") push("ACCOUNT", r.value);
    if (r.kind === "IBAN") push("IBAN", r.value);
    if (r.kind === "NATIONAL_ID") push("NATIONAL_ID", r.value);
  }

  if (tx.pos?.merchantId) push("MERCHANT_ID", tx.pos.merchantId);

  const name = tx.beneficiaryRaw?.trim();
  if (name && name.length >= 3) push("NAME", name);

  return out;
}

export interface ConfirmInput {
  userId: string;
  /** الجهة القائمة، أو اسمٌ لجهةٍ جديدة. */
  counterpartyId?: string;
  displayName?: string;
  kind: TxCategory;
  supplierId?: string | null;
  /** الحركة التي أكّدها الإنسان — تُستخرَج أدلّتها منها. */
  transaction: CanonicalTransaction;
}

export interface ConfirmResult {
  counterpartyId: string;
  created: boolean;
  /** الأدلّة التي أُضيفت الآن. */
  added: EvidenceItem[];
  /** أدلّة تدلّ على جهةٍ أخرى — تُعرَض ولا تُسحَب بصمت. */
  conflicts: { evidence: EvidenceItem; ownedBy: string }[];
}

/**
 * يؤكّد أنّ هذه الحركة لهذه الجهة، ويحفظ أدلّتها.
 *
 * والتضارب لا يُحسَم بصمت: دليلٌ يدلّ على جهةٍ أخرى يُعرَض على صاحب
 * العمل — قد يكون خطأً سابقاً، وقد يكون حسابين لشخصٍ واحد.
 */
export async function confirmCounterparty(input: ConfirmInput): Promise<ConfirmResult> {
  const evidence = evidenceFrom(input.transaction);

  const existingOwners = evidence.length > 0
    ? await db
        .select({
          kind: counterpartyEvidence.kind,
          normalized: counterpartyEvidence.normalized,
          counterpartyId: counterpartyEvidence.counterpartyId,
          displayName: counterparties.displayName,
        })
        .from(counterpartyEvidence)
        .innerJoin(counterparties, eq(counterparties.id, counterpartyEvidence.counterpartyId))
        .where(inArray(counterpartyEvidence.normalized, evidence.map((e) => e.normalized)))
    : [];

  let counterpartyId = input.counterpartyId;
  let created = false;

  if (!counterpartyId) {
    counterpartyId = createId();
    created = true;
    await db.insert(counterparties).values({
      id: counterpartyId,
      displayName: input.displayName?.trim()
        || input.transaction.beneficiaryRaw?.trim()
        || "جهة بلا اسم",
      kind: input.kind,
      supplierId: input.supplierId ?? null,
      createdById: input.userId,
    });
  } else {
    await db
      .update(counterparties)
      .set({ kind: input.kind, supplierId: input.supplierId ?? null, updatedAt: new Date() })
      .where(eq(counterparties.id, counterpartyId));
  }

  const conflicts: ConfirmResult["conflicts"] = [];
  const added: EvidenceItem[] = [];

  for (const e of evidence) {
    const owners = existingOwners.filter(
      (o) => o.kind === e.kind && o.normalized === e.normalized,
    );
    const mine = owners.find((o) => o.counterpartyId === counterpartyId);
    const others = owners.filter((o) => o.counterpartyId !== counterpartyId);

    /*
      التضارب يُعلَن في القاطع وحده.

      كان يُعلَن في كل نوع — فمن أكّد جهةً اسمها «مؤسسة الرياض للتجارة»
      وفي النظام أخرى بالاسم نفسه، رُدّ دليلُه وقيل له «الاسم لجهة
      أخرى». وليس تضارباً: هما مؤسّستان، والاسم لا يدلّ على واحدة.
    */
    if (others.length > 0 && isConflict(e.kind, false)) {
      conflicts.push({ evidence: e, ownedBy: others[0].displayName });
      continue;
    }

    if (mine) {
      // الدليل المتكرّر أوثق — يُعدّ ولا يُكرَّر
      await db
        .update(counterpartyEvidence)
        .set({ confirmations: sql`${counterpartyEvidence.confirmations} + 1` })
        .where(and(
          eq(counterpartyEvidence.counterpartyId, counterpartyId),
          eq(counterpartyEvidence.kind, e.kind),
          eq(counterpartyEvidence.normalized, e.normalized),
        ));
      continue;
    }

    /*
      الظنّي المشترك يُحفَظ للجهتين معاً — ثمّ يُسقطه القارئ من الذاكرة
      لأنّه لم يعد يدلّ على واحدة. حفظُه ليس عبثاً: هو يوثّق أنّ الاسم
      مشترَك، وبه يُعرَف سببُ سقوطه.
    */
    await db.insert(counterpartyEvidence).values({
      id: createId(),
      counterpartyId,
      kind: e.kind,
      value: e.value,
      normalized: e.normalized,
      confirmedById: input.userId,
    }).onConflictDoNothing();
    added.push(e);
  }

  await recordAudit({
    actorId: input.userId,
    action: "SUPPLIER_ALIAS_LEARNED",
    entityType: "counterparty",
    entityId: counterpartyId,
    after: {
      الجهة: input.displayName ?? input.transaction.beneficiaryRaw ?? "—",
      الباب: input.kind,
      "أدلّة أُضيفت": added.map((a) => `${a.kind}:${a.value}`),
      تضارب: conflicts.map((c) => `${c.evidence.kind}:${c.evidence.value} → ${c.ownedBy}`),
    },
  });

  return { counterpartyId, created, added, conflicts };
}

/**
 * يبني الذاكرة التي يستعملها المصنِّف.
 *
 * ومفاتيحها بصيغة `merchantKey` نفسها كي يجدها المصنِّف بلا ترجمة.
 */
export async function loadMerchantMemory(): Promise<Map<string, MerchantMemory>> {
  const rows = await db
    .select({
      kind: counterpartyEvidence.kind,
      normalized: counterpartyEvidence.normalized,
      confirmations: counterpartyEvidence.confirmations,
      counterpartyId: counterparties.id,
      txKind: counterparties.kind,
      supplierId: counterparties.supplierId,
    })
    .from(counterpartyEvidence)
    .innerJoin(counterparties, eq(counterparties.id, counterpartyEvidence.counterpartyId))
    .where(eq(counterparties.isActive, true));

  const memory = new Map<string, MerchantMemory>();

  /*
    الدليل الظنّي المشترك يُسقَط، لا يُرجَّح أحدُ صاحبيه.

    كان `memory.set` يكتب فوق سابقه، فإن حمل الاسمَ نفسه جهتان فازت
    آخرُ صفٍّ قرأته القاعدة — بلا ترتيبٍ مضمون. فتُصنَّف حركةُ هذه
    باسم تلك، ويُنسَب سدادٌ إلى مورّدٍ لم يُدفَع له. والصمت هنا أسوأ من
    الجهل: الجهل يُعرَض ويُراجَع.
  */
  const ambiguous = new Set<string>();
  for (const r of rows) {
    const key = memoryKey(r.kind, r.normalized);
    if (!key || isExclusive(r.kind)) continue;
    const prior = memory.get(key);
    if (prior && prior.counterpartyId !== r.counterpartyId) ambiguous.add(key);
    memory.set(key, {
      key,
      kind: fromCategory(r.txKind),
      supplierId: r.supplierId,
      confirmations: r.confirmations,
      counterpartyId: r.counterpartyId,
    });
  }
  for (const key of ambiguous) memory.delete(key);

  for (const r of rows) {
    const key = memoryKey(r.kind, r.normalized);
    if (!key || !isExclusive(r.kind)) continue;
    memory.set(key, {
      key,
      /*
        تُترجَم لا تُسنَد: العمود من `TxCategory` والمحرّك يتكلّم
        `TxKind`. وكانت `as` تُسكت المترجم فتخرج كل جهةٍ متعلَّمة من
        مطابقة الفواتير صامتةً.
      */
      kind: fromCategory(r.txKind),
      supplierId: r.supplierId,
      confirmations: r.confirmations,
      counterpartyId: r.counterpartyId,
    });
  }

  return memory;
}

/** يترجم نوع الدليل إلى المفتاح الذي يبحث به المصنِّف. */
function memoryKey(kind: string, normalized: string): string | null {
  if (kind === "ACCOUNT" || kind === "IBAN") return `ACC:${normalized}`;
  if (kind === "NATIONAL_ID") return `ID:${normalized}`;
  if (kind === "MERCHANT_ID") return `POS:${normalized}`;
  if (kind === "NAME") return `NAME:${normalized}`;
  return null;
}
