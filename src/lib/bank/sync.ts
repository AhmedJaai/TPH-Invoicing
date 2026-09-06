/**
 * مزامنة الكشف — لا استيراده.
 *
 * الفرق ليس في الكلمة. «استيراد» يعني: خذ الملفّ وأدخِله. و«مزامنة»
 * تعني: انظر ما الجديد فيه وأضِفه وحده. وصاحب العمل يريد الثانية —
 * يرفع كشفاً فيه ثلاثمئة حركة، مئتان وتسعون منها عنده، فلا يُعرَض
 * عليه إلّا الجديد.
 *
 * ═══ هويّة الحركة: طبقتان لا واحدة ═══
 *
 * **الأولى — مرجع العمليّة.** حين يعطي البنك رقماً خاصّاً بالحوالة،
 * فهو هويّتها. ووصفُها قد يتغيّر بين تصديرٍ وآخر — «TRF AL FALAH»
 * تصير «LOCAL TRANSFER AL FALAH TRADING CO.» — والعمليّة واحدة. ومن
 * جعل الوصفَ هويّةً أدخلها مرّتين.
 *
 * **الثانية — الوقائع.** حين لا مرجع: الحساب والتاريخ والمبلغ
 * والاتجاه والوصف موحَّداً. وهذه أضعف بطبعها، فيُبنى عليها بحذر.
 *
 * ═══ وما لا يدخل الهويّة ═══
 *
 * **«نوع العملية» لا يدخلها** — وهذا مقيس لا مفترَض: في قاعدة أحمد
 * تصديران للفترة نفسها، أحدهما يملأ العمود في ١٤٤٥ حركة والآخر يتركه
 * فارغاً في ١٤١٣. فلو دخل لانقسمت الحركة الواحدة بين ملفّين. وهو
 * الدرس الذي أخرج رقمَ الحساب من البصمة، ثمّ أخرج الوصفَ من هويّة
 * الحوالة ذات المرجع.
 *
 * **وترتيب الصفّ لا يدخلها إلّا آخر شيء.** `occurrence` ليس هويّة، هو
 * فاصلٌ بين متطابقتين لا مرجع لهما — وحين تكون في الملفّ حركتان
 * متطابقتان حقّاً (رسمان في يوم) يُبقيهما اثنتين. ولا يُعتمَد عليه في
 * تمييز حركةٍ عن أخرى مختلفة.
 */
import { normalizeText, type CanonicalTransaction } from "./canonical";
import { operationRef, operationRefs } from "./identity";

/** على أيّ شيء قامت الهويّة. */
export type IdentityBasis = "REFERENCE" | "FACTS";

/**
 * الوصف موحَّداً للهويّة.
 *
 * يُزال ما هو **عرضٌ** لا معنى: الفراغ والترقيم وحالة الأحرف وصيغ
 * الهمزة والتاء المربوطة. ولا يُزال ما يفرّق بين جهتين — الحروف
 * والأرقام تبقى كما هي.
 *
 * ولا يُبالَغ: «مؤسسة عمار» و«مؤسسة عماد» يجب أن تبقيا مختلفتين.
 */
export function identityText(text: string | null | undefined): string {
  return normalizeText(text)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * الوصف بعد إسقاط أرقامه — مفتاحٌ متساهل.
 *
 * لأنّ التصدير قد يضيف مرجعاً لم يكن، أو يغيّر رقم عمليّةٍ في نصّه.
 * فالمتساهل يُبقي الكلمات ويُسقط ما يتغيّر، ويُستعمَل **بعد** الصارم
 * وحين يكون أحد الطرفين بلا مرجع — لا لتوسيع المطابقة بل لتضييق
 * التكرار.
 */
export function looseText(text: string | null | undefined): string {
  return identityText(text)
    .split(" ")
    // كلّ ما فيه رقم مرجعٌ أو تاريخٌ أو رقمُ عمليّة — يتغيّر ويبقى المعنى
    .filter((t) => t.length > 0 && !/\p{N}/u.test(t))
    // وكلمةُ «مرجع» نفسها تسقط: التصدير يذكرها حيناً ويتركها حيناً
    .filter((t) => !/^(مرجع|سداد|REF|REFERENCE|VALUE|DATE)$/u.test(t))
    .join(" ");
}

export interface RowFacts {
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
}

/** نطاق الحساب — و«المجهول» نطاقٌ واحد حتى يُعرَف. */
export const UNKNOWN_ACCOUNT = "~";

/**
 * مفتاح الوقائع — **بلا حساب**.
 *
 * والنطاق يقع في اختيار ما يُقابَل لا في المفتاح: لو دخل الحسابُ
 * المفتاحَ لتغيّر المفتاح بتغيّر ما نعرفه عن الحساب — وهو الذي أدخل
 * الكشف مرّتين حين صار القارئ يقرأ رقم الحساب بعد أن كان لا يقرأه.
 *
 * التاريخ يُؤخَذ بيومه في UTC — والملفّات تُصدَّر بصيغ مختلفة، فلو
 * أُخذ بالساعة لصارت الحركة الواحدة حركتين لاختلاف منطقة زمنيّة.
 */
export function factKey(row: RowFacts): string {
  return [
    row.valueDate.toISOString().slice(0, 10),
    String(row.amountMinor),
    row.direction,
    identityText(row.description),
  ].join("|");
}

/** المفتاح المتساهل: كالوقائع، والوصفُ بلا أرقام. */
export function looseKey(row: RowFacts): string {
  return [
    row.valueDate.toISOString().slice(0, 10),
    String(row.amountMinor),
    row.direction,
    looseText(row.description),
  ].join("|");
}

/** المفتاح المخزَّن: مرجعُ العمليّة إن وُجد، وإلّا الوقائع وترتيبها. */
export function identityKeyOf(
  accountId: string | null,
  ref: string | null,
  facts: string,
  occurrence: number,
): string {
  const scope = accountId ?? UNKNOWN_ACCOUNT;
  return ref !== null ? `REF:${scope}|${ref}` : `FACT:${scope}|${facts}|${occurrence}`;
}

/** ما يعرفه النظام عن حركةٍ مقيَّدة. */
export interface KnownRow {
  id: string;
  /** حسابه — و`null` يعني «لم نكن نعرف»، فيُقابَل بأيّ حساب. */
  accountId: string | null;
  /** كل ما يدلّ على عمليّته. */
  refs: string[];
  operationRef: string | null;
  factKey: string;
  looseKey: string;
}

export type Verdict =
  /** مقيَّدة من قبل — لا تُضاف، ولا يُعاد حسابها. */
  | { status: "KNOWN"; matchedId: string; basis: IdentityBasis; reason: string }
  /** جديدة — تُقيَّد وتُسوَّى. */
  | { status: "NEW"; identityKey: string; occurrence: number; operationRef: string | null }
  /** ملتبسة — لا تُدسّ ولا تُبتلَع، تُعرَض ليقرّر إنسان. */
  | { status: "AMBIGUOUS"; reason: string; againstId: string };

export interface Incoming<T> {
  row: T;
  tx: CanonicalTransaction;
}

export interface SyncResult<T> {
  known: { row: T; verdict: Extract<Verdict, { status: "KNOWN" }> }[];
  fresh: { row: T; verdict: Extract<Verdict, { status: "NEW" }> }[];
  ambiguous: { row: T; verdict: Extract<Verdict, { status: "AMBIGUOUS" }> }[];
  /** ما يُكتَب للحركات المقيَّدة التي عرفنا مرجعها الآن. */
  enrich: { id: string; operationRef: string }[];
}

/**
 * يقسم صفوف الملفّ: ما هو عندنا، وما هو جديد، وما التبس.
 *
 * ويقع **قبل** التسوية عمداً: لا معنى لأن يُحسَب لثلاثمئة حركة
 * مرشّحوها ودرجاتُها ثمّ يُكتشَف أنّ مئتين وتسعين منها مقيَّدة.
 */
export function syncRows<T>(
  incoming: readonly Incoming<T>[],
  existing: readonly KnownRow[],
  accountId: string | null,
): SyncResult<T> {
  /*
    ما يُقابَل: حركاتُ هذا الحساب، وحركاتُ «المجهول».

    والمجهول ليس حساباً آخر، هو «لم نكن نعرف» — وقد وقع العطب مرّةً
    حين عُومل نطاقاً مستقلّاً، فدخل الكشف كلّه ثانيةً.
  */
  const pool = accountId === null
    /*
      والوارد المجهولُ حسابُه يُقابَل بالكلّ — لأنّنا لا نعرف أنّه من
      حسابٍ آخر، والادّعاء بذلك يُضاعف المال. وهذا هو الاتّجاه الآخر
      من العطب نفسه: مرّةً كان المقيَّد في «المجهول» والوارد بحساب،
      واليوم قد ينعكس إن عجز القارئ عن قراءة الرقم.
    */
    ? existing
    : existing.filter((e) => e.accountId === null || e.accountId === accountId);

  const byRef = new Map<string, KnownRow>();
  const strict = new Map<string, KnownRow[]>();
  const loose = new Map<string, KnownRow[]>();
  const stored = new Map<string, number>();
  const gone = new Set<string>();

  for (const e of pool) {
    for (const r of e.refs) if (!byRef.has(r)) byRef.set(r, e);
    const a = strict.get(e.factKey) ?? [];
    a.push(e);
    strict.set(e.factKey, a);
    stored.set(e.factKey, a.length);
    const b = loose.get(e.looseKey) ?? [];
    b.push(e);
    loose.set(e.looseKey, b);
  }

  const result: SyncResult<T> = { known: [], fresh: [], ambiguous: [], enrich: [] };
  const addedSoFar = new Map<string, number>();

  const claim = (hit: KnownRow) => {
    gone.add(hit.id);
    for (const r of hit.refs) if (byRef.get(r)?.id === hit.id) byRef.delete(r);
  };
  const waiting = (m: Map<string, KnownRow[]>, k: string) =>
    (m.get(k) ?? []).filter((e) => !gone.has(e.id));

  for (const item of incoming) {
    const facts = factKey(item.tx);
    const lax = looseKey(item.tx);
    const refs = operationRefs(item.tx);
    const ref = operationRef(item.tx);

    /* ── الأولى: مرجعٌ مشترك — مرجعٌ واحد يكفي ── */
    const byReference = refs.map((r) => byRef.get(r)).find((e) => e && !gone.has(e.id));
    if (byReference) {
      claim(byReference);
      result.known.push({
        row: item.row,
        verdict: {
          status: "KNOWN", matchedId: byReference.id, basis: "REFERENCE",
          reason: "مرجع العمليّة نفسه — والوصف قد يتغيّر والعمليّة واحدة",
        },
      });
      continue;
    }

    /* ── الثانية: الوقائع، صارمةً ثمّ متساهلة ── */
    const exact = waiting(strict, facts);

    /*
      المتساهل يُستعمَل بالعدّ كالصارم.

      وهو يُسقط الأرقام وحدها ويُبقي الكلمات والتاريخ والمبلغ — فرسمان
      متطابقان في يومٍ واحد يتساويان فيه، وذاك بعينه ما يعالجه العدّ:
      مقيَّدان يقابلان واردَين، وثالثٌ وارد يدخل جديداً. ولا يُبتلَع
      شيء ما دام العدد محفوظاً.
    */
    const laxPool = waiting(loose, lax);
    const near = exact.length > 0 ? exact : laxPool;

    if (near.length > 0) {
      const isLoose = exact.length === 0;

      /*
        مرجعان مختلفان على وقائع واحدة **ليسا التباساً**: البنك يعطي
        كلّ عمليّةٍ رقمها، فاختلافُ الرقمين اختلافُ عمليّتين. تدخل
        جديدةً ولا تُبتلَع.
      */
      const target = ref !== null
        ? near.find((e) => e.operationRef === null) ?? (isLoose ? undefined : near[0])
        : near[0];

      /*
        والالتباس الحقيقيّ: الوارد بلا مرجع، وما يقابله بالتساهل له
        مرجع. أهي هي صُدِّرت بلا رقمها، أم عمليّةٌ ثانية تشبهها؟ لا
        يُحسَم بالتخمين، ولا يُحذَف طرف، ولا تُدسّ في المقيَّد.
      */
      if (ref === null && isLoose && target && target.operationRef !== null) {
        result.ambiguous.push({
          row: item.row,
          verdict: {
            status: "AMBIGUOUS", againstId: target.id,
            reason: "وقائعها تطابق حركةً لها مرجع، وهي بلا مرجع — أهي هي أم غيرها؟",
          },
        });
        continue;
      }

      if (target) {
        claim(target);
        /*
          مرجعٌ عرفناه الآن لحركةٍ قُيّدت بلا مرجع: لم تتغيّر الحركة،
          تحسّن ما نعرفه عنها. فيُكتَب المرجع ولا تُنشَأ حركةٌ ثانية.
        */
        if (ref !== null && target.operationRef === null) {
          result.enrich.push({ id: target.id, operationRef: ref });
        }
        result.known.push({
          row: item.row,
          verdict: {
            status: "KNOWN", matchedId: target.id, basis: "FACTS",
            reason: isLoose
              ? "التاريخ والمبلغ والوصف نفسها بعد إسقاط الأرقام المتغيّرة"
              : "التاريخ والمبلغ والاتجاه والوصف نفسها",
          },
        });
        continue;
      }
    }

    /* ── جديدة ── */
    const added = addedSoFar.get(facts) ?? 0;
    const occurrence = (stored.get(facts) ?? 0) + added;
    addedSoFar.set(facts, added + 1);

    result.fresh.push({
      row: item.row,
      verdict: {
        status: "NEW",
        occurrence,
        operationRef: ref,
        identityKey: identityKeyOf(accountId, ref, facts, occurrence),
      },
    });
  }

  return result;
}
