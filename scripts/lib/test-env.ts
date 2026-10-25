/**
 * بيئةُ الاختبار — فرعُ Neon «test» نسخةٌ من الإنتاج يُكتب فيها بلا خوف.
 *
 * كانت التجربةُ على قاعدة المعاينة (`ux-redesign`) أو على فرعٍ مؤقّتٍ يُبنى
 * لكلّ مهمّةٍ ثمّ يُحذف. والأولى تبتعد عن الإنتاج شهراً بعد شهر، والثاني
 * يُبنى بيدٍ في كلّ مرّة. فصار للاختبار فرعٌ واحدٌ باقٍ يُعاد إلى حال
 * الإنتاج بأمرٍ واحد، ووجهتُه في `.env.test` (غير متتبَّع).
 *
 * والحارسُ هنا: لا تُشغَّل البيئة على قاعدةٍ مضيفُها مضيفُ الإنتاج
 * (`DATABASE_URL` في `.env`) — فخطأٌ في نسخ الوجهة لا يصير كتابةً في
 * بيانات المقهى الحقيقيّة.
 */

/** المضيفُ بلا «-pooler»: النقطةُ المجمَّعة والمباشرة لفرعٍ واحد مضيفٌ واحد. */
export function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace("-pooler.", ".");
  } catch {
    return null;
  }
}

/** سببُ الرفض، أو `null` إن كانت الوجهةُ صالحةً للاختبار. */
export function testDatabaseProblem(testUrl: string | undefined, productionUrl: string | undefined): string | null {
  const test = endpointOf(testUrl);
  if (!test) return "لا وجهةَ لقاعدة الاختبار: `TEST_DATABASE_URL` في `.env.test` ناقصٌ أو غير مقروء.";
  const prod = endpointOf(productionUrl);
  if (prod && prod === test) return "وجهةُ الاختبار هي قاعدةُ الإنتاج نفسُها — لا تُشغَّل البيئة عليها.";
  return null;
}

/** فرعٌ يُعاد من الإنتاج: لا يكون الإنتاجَ نفسَه ولا بلا معرّف. */
export function resettableBranch(branchId: string | undefined, productionBranchId: string): string | null {
  if (!branchId) return "لا معرّفَ لفرع الاختبار: `TEST_NEON_BRANCH_ID` في `.env.test` ناقص.";
  if (branchId === productionBranchId) return "معرّفُ فرع الاختبار هو فرعُ الإنتاج — لا يُعاد.";
  return null;
}
