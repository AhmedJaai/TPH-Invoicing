import { isAuthBypassed } from "@/lib/session";

/**
 * شريط ظاهر في كل صفحة حين يكون تسجيل الدخول معطّلاً.
 * ظهوره مقصود ومزعج: وضع التجربة يجب ألّا يُنسى مشتغلاً.
 */
export function TrialBanner() {
  if (!isAuthBypassed()) return null;

  return (
    <div className="border-b border-warn/40 bg-warn-bg px-5 py-2 text-center">
      <p className="text-[11px] font-bold leading-relaxed text-warn">
        وضع التجربة — تسجيل الدخول معطّل، وكل من يعرف الرابط يدخل.
        لا ترفع فواتير حقيقية قبل إعداد دخول جوجل.
      </p>
    </div>
  );
}
