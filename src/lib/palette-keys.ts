/**
 * تنقّلُ لوحة الأوامر بالمفاتيح — أين يقع المؤشّرُ بعد المفتاح.
 *
 * كان السهمان وحدهما، والقائمةُ بلا كتابة تسرد كلَّ الأوامر: بلوغُ «انتقل إلى»
 * اثنتا عشرة ضغطة. فصار `Tab` يقفز إلى أوّل المجموعة التالية (و`Shift+Tab`
 * السابقة)، و`Home`/`End` لأوّل القائمة وآخرها. دالّةٌ خالصة: المجموعاتُ بترتيب
 * صفوفها، والمؤشّرُ يدور عند الطرفين كما يدور السهمان.
 */
export type PaletteKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "NextGroup" | "PrevGroup";

export function movePaletteCursor(groups: readonly string[], current: number, key: PaletteKey): number {
  const n = groups.length;
  if (n === 0) return 0;
  if (key === "ArrowDown") return (current + 1) % n;
  if (key === "ArrowUp") return (current - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  /* بداياتُ المجموعات: كلُّ صفٍّ يخالف مجموعةَ سابقه */
  const starts = groups.flatMap((g, i) => (i === 0 || groups[i - 1] !== g ? [i] : []));
  if (key === "NextGroup") return starts.find((s) => s > current) ?? starts[0];
  /* السابقة: بدايةُ مجموعتي إن كنتُ في وسطها، وإلّا بدايةُ التي قبلها */
  const before = starts.filter((s) => s < current);
  return before.length > 0 ? before[before.length - 1] : starts[starts.length - 1];
}
