/**
 * طابورُ الالتقاط — يحمل الملفّ من زرّ الكاميرا أو من الإفلات في أيّ صفحة
 * إلى قارئ المستندات في `/upload`.
 *
 * فتحُ الكاميرا يحتاج ضغطةً من المستخدم، والانتقالُ إلى صفحةٍ أخرى يُضيّعها.
 * فالزرُّ الدائم يلتقط الملفّ حيث هو، ويضعه هنا، ثمّ ينتقل. والقارئ يأخذ
 * ما هنا حين يُركَّب ويستمع لما يصل بعده. وحالةُ الوحدة تبقى بين الصفحات
 * لأنّ التنقّل داخل التطبيق لا يعيد تحميلها.
 *
 * للمتصفّح وحده — لا يُستورَد في الخادم.
 */
let pending: File[] = [];
const listeners = new Set<() => void>();

export function queueCapture(files: Iterable<File>) {
  const accepted = Array.from(files).filter(
    (f) => f.type === "application/pdf" || f.type.startsWith("image/") || /\.pdf$/i.test(f.name),
  );
  if (accepted.length === 0) return 0;
  pending = [...pending, ...accepted];
  listeners.forEach((l) => l());
  return accepted.length;
}

export function takeCaptured(): File[] {
  const out = pending;
  pending = [];
  return out;
}

export function onCaptured(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
