/**
 * ترجمةُ الواجهة إلى الإنجليزية — دالّةٌ نقيّة تأخذ نصّاً عربياً كما رُسم
 * وتعيد مقابله من القاموس (`public/i18n/en.json`).
 *
 * النصوص في الشيفرة عربيّةٌ مكتوبة في مواضعها، فلا تُستبدَل بمفاتيح؛ القاموسُ
 * يُستخرَج منها (`scripts/i18n/ar-strings.mjs extract`) ويُطابَق على ما يُرسم:
 *   ١. النصّ كاملاً كما هو.
 *   ٢. قالبٌ فيه قيم (`${n} فواتير`) ← `{0} فواتير`، وكلّ قيمةٍ تُترجَم وحدها.
 *   ٣. وإلّا قُسّم على الفواصل (« — »، « · »، «، ») وتُرجم كلّ جزءٍ يُعرف.
 * وما لا يُعرف يبقى كما هو — بياناتٌ (اسمُ مورّد، نصٌّ من المستند) لا تُخترَع ترجمتُها.
 */

export type Dictionary = Record<string, string>;

const ARABIC = /[\u0621-\u064A\u0671-\u06D3]/; // حروفٌ لا أرقام
const SLOT = /\{(\d+)\}/g;
const HAS_SLOT = /\{\d+\}/;

/** الأرقامُ الهنديّة وعلاماتُ الترقيم العربيّة إلى مقابلها اللاتينيّ. */
export function latinize(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/٪/g, "%")
    .replace(/،/g, ",")
    .replace(/؛/g, ";")
    .replace(/؟/g, "?")
    .replace(/[«»]/g, "\"")
    .replace(/ـ/g, "");
}

export function hasArabic(s: string): boolean {
  return ARABIC.test(s);
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface Template {
  re: RegExp;
  en: string;
  /** ترتيبُ الخانات في النصّ العربيّ — `{1}` قد تسبق `{0}`. */
  order: number[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Translator {
  private exact = new Map<string, string>();
  private byHead = new Map<string, Template[]>();
  private byTail = new Map<string, Template[]>();
  private cache = new Map<string, string>();

  constructor(dict: Dictionary) {
    for (const [ar, en] of Object.entries(dict)) {
      const key = normalize(ar);
      if (!HAS_SLOT.test(key)) {
        this.exact.set(key, en);
        continue;
      }
      const order: number[] = [];
      const parts = key.split(SLOT);
      let src = "^";
      parts.forEach((p, i) => {
        if (i % 2 === 0) src += escapeRe(p);
        else {
          order.push(Number(p));
          src += "(.+?)";
        }
      });
      const t: Template = { re: new RegExp(src + "$"), en, order };
      const head = parts[0];
      const tail = parts[parts.length - 1];
      if (head.length >= 2) push(this.byHead, head.slice(0, 2), t);
      else if (tail.length >= 2) push(this.byTail, tail.slice(-2), t);
    }
  }

  /** يترجم نصّاً كما رُسم، ويُبقي مسافاته في طرفيه. */
  translate(raw: string): string {
    if (!hasArabic(raw)) return latinize(raw);
    const cached = this.cache.get(raw);
    if (cached !== undefined) return cached;
    const lead = raw.match(/^\s*/)![0];
    const trail = raw.slice(lead.length).match(/\s*$/)![0];
    const out = lead + this.core(normalize(raw), 0) + trail;
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(raw, out);
    return out;
  }

  private core(s: string, depth: number): string {
    if (!s) return s;
    if (!hasArabic(s)) return latinize(s);
    const hit = this.exact.get(s);
    if (hit !== undefined) return hit;
    if (depth > 3) return latinize(s);

    const cands = [...(this.byHead.get(s.slice(0, 2)) ?? []), ...(this.byTail.get(s.slice(-2)) ?? [])];
    for (const t of cands) {
      const m = t.re.exec(s);
      if (!m) continue;
      const values: string[] = [];
      t.order.forEach((slot, i) => (values[slot] = this.core(m[i + 1].trim(), depth + 1)));
      return t.en.replace(SLOT, (_, n) => values[Number(n)] ?? "");
    }

    /* تقسيمٌ على الفواصل — كلُّ جزءٍ يُترجَم وحده إن عُرف */
    for (const sep of [" — ", " · ", "؛ ", "، ", ": ", " – "]) {
      if (!s.includes(sep)) continue;
      const pieces = s.split(sep);
      const done = pieces.map((p) => this.core(p.trim(), depth + 1));
      if (done.some((d, i) => hasArabic(pieces[i]) && d !== pieces[i].trim())) {
        return done.join(latinize(sep));
      }
    }
    /* لاحقةٌ أو سابقةٌ رمزيّة: «… (٣)» أو «٣ …» */
    const wrapped = s.match(/^([\d٠-٩٬٫.,%+−\-()\s×·:#…]*)(.*?)([\d٠-٩٬٫.,%+−\-()\s×·:#…]*)$/);
    if (wrapped && (wrapped[1] || wrapped[3]) && wrapped[2]) {
      const mid = this.exact.get(normalize(wrapped[2]));
      if (mid !== undefined) return latinize(wrapped[1]) + mid + latinize(wrapped[3]);
    }
    return s;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
