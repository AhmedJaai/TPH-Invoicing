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

/**
 * أيُقرأ هذا الملفّ؟ — شرطٌ واحد لكلّ باب (زرُّ الالتقاط · الإفلات · اللصق ·
 * المشاركة · مربّعُ صفحة الرفع).
 *
 * كروم يرسل صورةَ الآيفون (HEIC) **بنوعٍ فارغ**، وكان هذا الباب يردّها «لا يُقرأ
 * إلّا PDF أو صورة» ومربّعُ صفحة الرفع يقبلها بامتدادها — الملفُّ نفسُه بحكمين.
 * فالامتدادُ يكفي حين يغيب النوع. والحكمُ الأخير للخادم (بصمةُ الملفّ).
 */
const READABLE_EXT = /\.(pdf|jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;

export function isReadableFile(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) return true;
  /* نوعٌ معلَنٌ غيرُ مقروء (نصّ، جدول) لا ينقذه امتدادُه */
  if (file.type && file.type !== "application/octet-stream") return false;
  return READABLE_EXT.test(file.name);
}

export function queueCapture(files: Iterable<File>) {
  const accepted = Array.from(files).filter(isReadableFile);
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
