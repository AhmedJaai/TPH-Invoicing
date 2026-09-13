/**
 * حارسُ النصوص الكاتبة.
 *
 * القاعدة في `.env` هي الإنتاج — لا قاعدةَ تطويرٍ منفصلة. فكلّ نصٍّ يكتب
 * فيها أو في أرشيف الدرايف يكتب في بيانات المقهى الحقيقيّة. وكان
 * `db:demo` يُدخل فواتير «DEMO-» في المستحقّ الحقيقيّ بلا سؤال، وأداةُ
 * تشخيص «بلا رفع» تُنشئ مجلّداً في الأرشيف.
 *
 * فالكتابة تحتاج إقراراً مكتوباً في الأمر نفسه — لا يُنسى ولا يُفترَض.
 */
export const PRODUCTION_FLAG = "--i-know-this-is-production";

export function writeAllowed(argv: readonly string[] = process.argv): boolean {
  return argv.includes(PRODUCTION_FLAG);
}

export function assertWriteAllowed(what: string, argv: readonly string[] = process.argv): void {
  if (writeAllowed(argv)) return;
  console.error(
    `\n✕ ${what} يكتب في قاعدة الإنتاج أو أرشيفها.\n` +
    `  لا قاعدةَ تطويرٍ منفصلة — فالتشغيل يمسّ بيانات المقهى الحقيقيّة.\n` +
    `  إن كان هذا مقصوداً فأعِد الأمر مع ${PRODUCTION_FLAG}\n`,
  );
  process.exit(1);
}
