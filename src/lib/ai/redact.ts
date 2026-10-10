/**
 * ما يغادر إلى النموذج بأقلّ قدرٍ من بيانات الأفراد — تنقيحٌ حتميّ يُعاد بعد الجواب.
 *
 * نصُّ الفاتورة ووصفُ الحوالة يُرسَلان إلى مزوّدٍ خارج المملكة، وفيهما آيبانُ المستفيد
 * وجوّالُه. والنموذجُ لا يحتاج الرقمَ نفسَه ليقرأ أو يرجّح — يحتاج أن يعرف أنّ هذا هو
 * ذاك. فيُستبدَل كلٌّ برمزٍ **ثابتٍ داخل النداء** (الآيبانُ نفسُه ← الرمزُ نفسُه، فتبقى
 * المساواةُ دليلاً)، ويُعاد الأصلُ في الجواب قبل أن يراه أحد.
 *
 * **وما يُنقَّح ما لا لبسَ في شكله وحده**: الآيبان السعوديّ والجوّال بصيغته الدوليّة.
 * رقمٌ من عشر خانات قد يكون جوّالاً أو هويّةً أو **رقمَ فاتورة** — ورقمُ الفاتورة يُنسَخ
 * حرفاً ولا يُغامَر به. والصورةُ لا تُنقَّح: ما في المسح يُرسَل كما هو.
 */

const IBAN = /\bSA\d{2}(?:[ \u00A0]?[0-9A-Z]{4}){5}\b/g;
/** +9665XXXXXXXX أو 009665XXXXXXXX — بفواصلَ أو بلا. */
const MOBILE = /(?:\+|00)966[ -]?5\d(?:[ -]?\d){7}\b/g;

const OPEN = "⟦";
const CLOSE = "⟧";
/** الرمزُ كما كُتب، أو وقد أسقط النموذجُ قوسَيه. */
const TOKEN = /⟦?\b(IBAN|MOBILE)_(\d+)\b⟧?/g;

export interface Redactor {
  /** يستبدل ما يُعرف شكلُه برموز. */
  redact(text: string): string;
  /** يُعيد الأصلَ مكان كلّ رمز — ورمزٌ لم نكتبه يبقى كما هو. */
  restore(text: string): string;
  /** كم قيمةً مختلفة نُقّحت. */
  readonly count: number;
}

export function createRedactor(): Redactor {
  const byValue = new Map<string, string>();
  const byToken = new Map<string, string>();
  const counters = { IBAN: 0, MOBILE: 0 };

  const tokenFor = (kind: "IBAN" | "MOBILE", raw: string): string => {
    /* المفتاحُ بلا فواصل ولا بادئة: «SA44 2000 …» و«SA442000…» آيبانٌ واحد، و«+966» و«00966» جوّالٌ واحد */
    const key = `${kind}:${raw.replace(/[ \u00A0-]/g, "").replace(/^(?:\+|00)/, "")}`;
    const known = byValue.get(key);
    if (known) return known;
    counters[kind] += 1;
    const name = `${kind}_${counters[kind]}`;
    const token = `${OPEN}${name}${CLOSE}`;
    byValue.set(key, token);
    /* يُعاد كما ورد أوّلَ مرّة */
    byToken.set(name, raw);
    return token;
  };

  return {
    redact(text) {
      return text
        .replace(IBAN, (m) => tokenFor("IBAN", m))
        .replace(MOBILE, (m) => tokenFor("MOBILE", m));
    },
    restore(text) {
      if (byToken.size === 0) return text;
      return text.replace(TOKEN, (whole, kind: string, n: string) => byToken.get(`${kind}_${n}`) ?? whole);
    },
    get count() {
      return byToken.size;
    },
  };
}
