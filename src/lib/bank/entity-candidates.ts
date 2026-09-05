/**
 * مرشّحو الجهة — حين لا يكفي الدليل الحاسم.
 *
 * كان النظام يقول للحركة المجهولة عالية القيمة: «تستحقّ حَكَماً»، ثمّ
 * يُنشئ حالةً **بلا مرشّحين** — والحَكَم يرفض ما لا مرشّح له. فالمسار
 * الذي صُمّم لها ميّت.
 *
 * والسبب معرفيّ لا برمجيّ: خُلط بين غموضين مختلفين.
 *
 *   غموضُ فاتورة: نعرف الجهة ونختلف أيّ فاتورة.
 *   غموضُ جهة:    لا نعرف من هي أصلاً.
 *
 * والثاني لا يُحلّ بمرشّحي فواتير، بل بمرشّحي **جهات**. وهذا ما يبنيه
 * هذا الملفّ: يرشّح الجهات الممكنة بأدلّة ضعيفة لا تكفي وحدها للحسم،
 * ثمّ يُسأل الحَكَم أيّها — أو لا شيء.
 */
import { normalizeText, type CanonicalTransaction } from "./canonical";
import { distinctiveTokens, tokenAppears, type SupplierIdentity } from "./entities";

export interface KnownCounterparty {
  id: string;
  displayName: string;
  supplierId: string | null;
  /** كم مرّة أكّده إنسان — الأكثر تأكيداً أرجح. */
  confirmations: number;
  /** أسماؤه المعروفة. */
  names: readonly string[];
}

export interface EntityCandidate {
  /** معرّف الجهة إن كانت مسجَّلة، أو معرّف المورّد. */
  counterpartyId: string | null;
  supplierId: string | null;
  displayName: string;
  /** ترجيحٌ ضعيف — لا يكفي للحسم، ويكفي للترشيح. */
  score: number;
  evidence: string[];
}

/** أدنى ترجيح يُرشَّح عنده — ما دونه ضجيج. */
export const MIN_CANDIDATE_SCORE = 0.15;

/** أقصى ما يُعرَض على الحَكَم — القائمة الطويلة تُشتّت لا تُعين. */
export const MAX_ENTITY_CANDIDATES = 5;

/**
 * يرشّح الجهات الممكنة لحركةٍ لم يُعرَف مستفيدها.
 *
 * والأدلّة هنا **ضعيفة عمداً**: لو كانت قويّة لحُسمت في `entities.ts`
 * ولم تصل إلى هنا. فيُقبَل تشابه كلمةٍ واحدة، وتُقبَل الجهة التي
 * تكرّر تأكيدها — وكلاهما لا يكفي وحده، ولذلك يُسأل.
 */
export function proposeEntities(
  tx: CanonicalTransaction,
  suppliers: readonly SupplierIdentity[],
  known: readonly KnownCounterparty[],
): EntityCandidate[] {
  const text = tx.searchText;
  if (text.length === 0) return [];

  const out = new Map<string, EntityCandidate>();

  const add = (c: EntityCandidate) => {
    const key = c.counterpartyId ?? c.supplierId ?? c.displayName;
    const existing = out.get(key);
    if (!existing || c.score > existing.score) out.set(key, c);
    else existing.evidence.push(...c.evidence);
  };

  /* ── جهاتٌ أكّدها إنسان من قبل ── */
  for (const k of known) {
    const hits = k.names
      .flatMap((n) => distinctiveTokens(n))
      .filter((t) => tokenAppears(t, text));

    if (hits.length === 0) continue;

    /*
      التأكيد المتكرّر يرفع الترجيح — لكنّه يبقى دون الحسم. فالجهة التي
      أُكّدت ثلاثين مرّة أرجح من واحدة، وليست يقيناً حين لا يطابق إلّا
      طرفُ اسمها.
    */
    const boost = Math.min(0.25, k.confirmations * 0.02);
    add({
      counterpartyId: k.id,
      supplierId: k.supplierId,
      displayName: k.displayName,
      score: Math.min(0.7, 0.3 + 0.1 * hits.length + boost),
      evidence: [
        `كلمة مشتركة: ${hits.join(" · ")}`,
        `أُكّدت هذه الجهة ${k.confirmations} مرّة`,
      ],
    });
  }

  /* ── مورّدون مسجَّلون ── */
  for (const s of suppliers) {
    const hits = [s.nameAr, s.nameEn, s.driveFolderName]
      .filter((n): n is string => Boolean(n))
      .flatMap((n) => distinctiveTokens(n))
      .filter((t) => tokenAppears(t, text));

    if (hits.length === 0) continue;

    add({
      counterpartyId: null,
      supplierId: s.supplierId,
      displayName: s.nameAr,
      score: Math.min(0.6, 0.25 + 0.12 * hits.length),
      evidence: [`كلمة مشتركة مع اسم المورّد: ${hits.join(" · ")}`],
    });
  }

  /* ── الاسم في الوصف نفسه ── */
  const fromText = beneficiaryGuess(tx);
  if (fromText) {
    const normalized = normalizeText(fromText);
    const already = [...out.values()].some(
      (c) => normalizeText(c.displayName) === normalized,
    );
    if (!already) {
      add({
        counterpartyId: null,
        supplierId: null,
        displayName: fromText,
        /*
          جهةٌ جديدة: ترجيحها أضعف من كل مسجَّل — لأنّ إنشاء جهةٍ أثقل
          من نسبتها إلى قائمة. ولا تُنشأ إلّا بإقرار.
        */
        score: MIN_CANDIDATE_SCORE + 0.05,
        evidence: ["اسمٌ يظهر في الوصف ولا يطابق جهةً مسجّلة — قد تكون جديدة"],
      });
    }
  }

  return [...out.values()]
    .filter((c) => c.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .slice(0, MAX_ENTITY_CANDIDATES);
}

/**
 * يستخرج اسماً محتملاً من الوصف.
 *
 * وأوصاف الأهلي تضع الاسم أوّلاً ثمّ `BEN ID` وما بعده. وما قبل هذه
 * العلامة أقرب ما يكون إلى اسمٍ — وما بعدها أرقامٌ ومراجع.
 */
export function beneficiaryGuess(tx: CanonicalTransaction): string | null {
  const raw = tx.beneficiaryRaw?.trim();
  if (raw && raw.length >= 4) return raw;

  const description = tx.description ?? "";
  const cut = description.search(/BEN\s*ID|رقم\s*السداد|مرجع|REFERENCE/i);
  const head = (cut > 0 ? description.slice(0, cut) : description).trim();

  const words = head.split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  if (words.length === 0) return null;

  const guess = words.slice(0, 5).join(" ");
  return guess.length >= 4 ? guess : null;
}
