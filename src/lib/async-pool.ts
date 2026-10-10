/**
 * حدُّ التزامن — يجري من الأعمال `limit` معاً، والباقي ينتظر دوره بترتيب وصوله.
 *
 * عشرون فاتورةً مسحوبةً معاً كانت عشرين طلبَ قراءةٍ متزامناً، كلٌّ يستدعي الذكاء
 * تحت مهلة ٦٠ ثانية — فيتعثّر بعضُها بحدّ المعدّل أو المهلة ويُعرَض «فشل» لملفٍّ
 * سليم. والعملُ الذي يرمي لا يوقف الطابور: مكانُه يُخلى لمن بعده.
 *
 * دالّةٌ خالصة — لا متصفّح — فتُختبَر.
 */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    active--;
    waiting.shift()?.();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
