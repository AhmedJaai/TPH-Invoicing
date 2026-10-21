import { describe, expect, it } from "vitest";
import { StabilityTracker } from "./stability";
import type { Quad } from "./geometry";

const frame = { width: 720, height: 1280 };
const paper: Quad = [{ x: 200, y: 200 }, { x: 520, y: 210 }, { x: 530, y: 1000 }, { x: 190, y: 990 }];
const move = (p: { x: number; y: number }, dx: number, dy: number) => ({ x: p.x + dx, y: p.y + dy });
const shift = (q: Quad, dx: number, dy = 0): Quad => [move(q[0], dx, dy), move(q[1], dx, dy), move(q[2], dx, dy), move(q[3], dx, dy)];

/** يغذّيه الرباعيَّ نفسَه (أو بحركة) كلَّ ١٠٠ مللي ثانية، ويُرجع لحظاتِ الالتقاط */
function run(t: StabilityTracker, frames: (Quad | null)[], start = 0) {
  const captures: number[] = [];
  frames.forEach((q, i) => {
    if (t.update(q, start + i * 100).capture) captures.push(i);
  });
  return captures;
}

describe("الالتقاطُ الآليّ", () => {
  it("يلتقط حين تثبت الورقة نحو ثانية — مرّةً واحدة", () => {
    const t = new StabilityTracker(frame);
    const captures = run(t, Array(30).fill(paper));
    expect(captures).toEqual([9]);
  });

  it("والارتجافُ اليسير ثباتٌ، والحركةُ الكبيرة تعيد العدّ", () => {
    const shaky = Array.from({ length: 15 }, (_, i) => shift(paper, i % 2 ? 4 : -4));
    expect(run(new StabilityTracker(frame), shaky)).toEqual([9]);
    const moving = Array.from({ length: 15 }, (_, i) => shift(paper, i * 30));
    expect(run(new StabilityTracker(frame), moving)).toEqual([]);
  });

  it("والانزلاقُ البطيء ليس ثباتاً — وإن قلّت الحركةُ بين إطارين", () => {
    /* ١٥ بكسلاً كلَّ إطار: دون حدّ الإطارين، لكنّها تبتعد عن موضعها الأوّل */
    const drifting = Array.from({ length: 20 }, (_, i) => shift(paper, i * 15));
    expect(run(new StabilityTracker(frame), drifting)).toEqual([]);
  });

  it("وإطارٌ شاذّ (زاويةٌ قفزت مرّة) لا يكسر الثبات", () => {
    const odd: Quad = [paper[0], paper[1], { x: paper[2].x, y: paper[2].y - 70 }, paper[3]];
    const frames = Array.from({ length: 15 }, (_, i) => (i % 4 === 3 ? odd : paper));
    expect(run(new StabilityTracker(frame), frames).length).toBe(1);
  });

  it("الورقةُ الصغيرة في الإطار لا تُلتقط — ويُقال إنّها صغيرة", () => {
    const tiny: Quad = [{ x: 300, y: 500 }, { x: 360, y: 500 }, { x: 360, y: 580 }, { x: 300, y: 580 }];
    const t = new StabilityTracker(frame);
    expect(run(t, Array(20).fill(tiny))).toEqual([]);
    expect(t.update(tiny, 5000).state.kind).toBe("TOO_SMALL");
  });

  it("لا يلتقط الصفحةَ نفسَها مرّتين — حتّى تغيب أو تتغيّر", () => {
    const t = new StabilityTracker(frame);
    const gone = Array(8).fill(null);
    /* ثابتةٌ ثلاث ثوانٍ: التقاطٌ واحد · ثمّ غابت (رُفعت الصفحة) · ثمّ صفحةٌ تالية في المكان نفسه */
    const captures = run(t, [...Array(30).fill(paper), ...gone, ...Array(15).fill(paper)]);
    expect(captures).toEqual([9, 47]);
  });

  it("وصفحةٌ تالية في موضعٍ آخر تُلتقط بلا غياب", () => {
    const t = new StabilityTracker(frame);
    const captures = run(t, [...Array(12).fill(paper), ...Array(15).fill(shift(paper, 200, 120))]);
    /* الوسيطُ يؤخّر الموضعَ الجديد إطاراً — ثمنُ ألّا يكسرَ إطارٌ شاذٌّ الثبات */
    expect(captures).toEqual([9, 22]);
  });

  it("الإطارُ المعروض يُنعَّم ولا يقفز، ولا يختفي لإطارٍ واحدٍ بلا اكتشاف", () => {
    const t = new StabilityTracker(frame);
    t.update(paper, 0);
    const d = t.update(shift(paper, 40), 100).display!;
    expect(d[0].x).toBeCloseTo(220);
    expect(t.update(null, 200).display).not.toBeNull();
    expect(t.update(null, 700).display).toBeNull();
  });
});
