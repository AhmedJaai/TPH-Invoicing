/**
 * متى يلتقط الماسحُ وحده؟ — كما في «الملاحظات»: حين تثبت الورقةُ في الإطار.
 *
 * كلُّ إطارٍ من الكاميرا يُكتشف فيه رباعيّ (أو لا). فيُلتقط حين:
 *   - تبقى الزوايا الأربع في مكانها (أقصى حركةٍ دون نسبةٍ من قطر الإطار) مدّةً كافية،
 *   - والورقةُ كبيرةٌ كفاية في الإطار،
 *   - ولم تُلتقط هذه الورقةُ نفسُها للتوّ: بعد الالتقاط ينتظر أن تتحرّك الورقةُ أو تغيب
 *     (صفحةٌ تالية) — وإلّا التقط الصفحةَ نفسَها مرّتين.
 *
 * والعرضُ يُنعَّم (متوسّطٌ متحرّك) فلا يرتجف الإطارُ الأصفر مع كلّ إطار.
 *
 * خالصة — الوقتُ يُعطى.
 */
import { quadArea, type Point, type Quad } from "./geometry";

export interface StabilityOptions {
  /** أقصى حركةٍ لزاويةٍ بين إطارين، نسبةً من قطر الإطار */
  maxMove: number;
  /** كم تثبت قبل الالتقاط (مللي ثانية) */
  holdMs: number;
  /** أصغرُ مساحةٍ للورقة من الإطار */
  minArea: number;
  /** بعد الالتقاط: كم تتحرّك (نسبةً من القطر) لتُعدّ صفحةً جديدة */
  rearmMove: number;
  /** وكم تغيب لتُعدّ صفحةً جديدة (مللي ثانية) */
  rearmGoneMs: number;
}

export const DEFAULT_STABILITY: StabilityOptions = {
  maxMove: 0.018,
  holdMs: 900,
  minArea: 0.06,
  rearmMove: 0.12,
  rearmGoneMs: 600,
};

export type ScanState =
  | { kind: "SEARCHING" }
  /** وُجدت الورقة، وتثبت — `progress` من ٠ إلى ١ نحو الالتقاط */
  | { kind: "HOLDING"; progress: number }
  /** صغيرةٌ في الإطار */
  | { kind: "TOO_SMALL" }
  /** التُقطت للتوّ — ينتظر الصفحة التالية */
  | { kind: "CAPTURED" };

const maxCornerMove = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

export class StabilityTracker {
  private last: Quad | null = null;
  private stableSince: number | null = null;
  /** موضعُ الورقة حين بدأ الثبات — الحركةُ البطيءة تتراكم عنه فتكسره */
  private anchor: Quad | null = null;
  private capturedQuad: Quad | null = null;
  private goneSince: number | null = null;
  private shown: Quad | null = null;
  /** آخرُ ثلاثة اكتشافات — وسيطُها يُسقط إطاراً شاذّاً (زاويةٌ قفزت في إطارٍ واحد) */
  private recent: Quad[] = [];

  constructor(
    private readonly frame: { width: number; height: number },
    private readonly opts: StabilityOptions = DEFAULT_STABILITY,
  ) {}

  private get diag() {
    return Math.hypot(this.frame.width, this.frame.height);
  }

  /** يغذّيه إطارٌ جديد؛ يُرجع الحال، و`capture: true` في الإطار الذي يُلتقط فيه. */
  update(quad: Quad | null, now: number): { state: ScanState; capture: boolean; display: Quad | null } {
    const o = this.opts;
    if (!quad) {
      this.last = null;
      this.stableSince = null;
      this.recent = [];
      this.goneSince ??= now;
      if (this.capturedQuad && now - this.goneSince >= o.rearmGoneMs) this.capturedQuad = null;
      /* يبقى الإطارُ لحظةً ثمّ يختفي — إطارٌ واحدٌ بلا اكتشاف لا يُطفئه */
      if (now - this.goneSince > 300) this.shown = null;
      return { state: this.capturedQuad ? { kind: "CAPTURED" } : { kind: "SEARCHING" }, capture: false, display: this.shown };
    }
    this.goneSince = null;
    this.recent = [...this.recent.slice(-2), quad];
    /* الوسيطُ لكلّ زاوية: إطارٌ واحدٌ شاذّ لا يكسر الثبات ولا يحرّك الإطار المعروض */
    quad = medianQuad(this.recent);
    this.shown = this.shown ? smooth(this.shown, quad, 0.5) : quad;

    if (this.capturedQuad) {
      if (maxCornerMove(quad, this.capturedQuad) / this.diag < o.rearmMove) {
        this.last = quad;
        return { state: { kind: "CAPTURED" }, capture: false, display: this.shown };
      }
      this.capturedQuad = null;
      this.stableSince = null;
    }

    if (quadArea(quad) / (this.frame.width * this.frame.height) < o.minArea) {
      this.last = quad;
      this.stableSince = null;
      return { state: { kind: "TOO_SMALL" }, capture: false, display: this.shown };
    }

    /*
      ثابتةٌ إن لم تتحرّك عن الإطار السابق ولا عن موضعها حين بدأ الثبات: يدٌ تنزلق
      ببطء تتحرّك قليلاً بين إطارين، لكنّها تبتعد عن موضعها الأوّل — وصورتُها مطموسة.
    */
    const steady = this.last !== null
      && maxCornerMove(quad, this.last) / this.diag <= o.maxMove
      && this.anchor !== null
      && maxCornerMove(quad, this.anchor) / this.diag <= o.maxMove * 1.5;
    if (steady) {
      this.stableSince ??= now;
    } else {
      this.stableSince = now;
      this.anchor = quad;
    }
    this.last = quad;
    const held = now - (this.stableSince ?? now);
    if (held >= o.holdMs) {
      this.capturedQuad = quad;
      this.stableSince = null;
      return { state: { kind: "CAPTURED" }, capture: true, display: this.shown };
    }
    return { state: { kind: "HOLDING", progress: held / o.holdMs }, capture: false, display: this.shown };
  }

  /** التقاطٌ باليد — يُعامَل كالآليّ: لا يُعاد على الورقة نفسها. */
  markCaptured(quad: Quad | null) {
    this.capturedQuad = quad;
    this.stableSince = null;
    this.anchor = null;
  }
}

function medianQuad(qs: readonly Quad[]): Quad {
  if (qs.length < 3) return qs[qs.length - 1];
  const med = (vals: number[]) => [...vals].sort((a, b) => a - b)[1];
  const corner = (i: number) => ({ x: med(qs.map((q) => q[i].x)), y: med(qs.map((q) => q[i].y)) });
  return [corner(0), corner(1), corner(2), corner(3)];
}

function smooth(prev: Quad, next: Quad, k: number): Quad {
  const mix = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  return [mix(prev[0], next[0]), mix(prev[1], next[1]), mix(prev[2], next[2]), mix(prev[3], next[3])];
}
