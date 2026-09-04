/**
 * عرض المال والفراغ.
 *
 * مفصولان عن `page-shell` عمداً: القشرة تجرّ قائمة المستخدم ومعها فعل
 * خادم، فإذا استوردها مكوّن عميل انكسر البناء. وهذان لا يحتاجان شيئاً
 * من ذلك، فيصلحان للطرفين.
 */

export function Money({ minor, tone }: { minor: number; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "";
  const whole = Math.floor(Math.abs(minor) / 100);
  const frac = String(Math.abs(minor) % 100).padStart(2, "0");
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <span className={`nums ${cls}`} dir="ltr">
      {minor < 0 ? "-" : ""}
      {digits}.{frac}
    </span>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
