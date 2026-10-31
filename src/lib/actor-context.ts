/**
 * «مَن فعل هذا؟» حين لا يكون إنساناً — التشغيلُ المجدول (`/api/cron/*`).
 *
 * الخدماتُ تكتب الفاعلَ معرّفَ مستخدمٍ (مفتاحٌ أجنبيّ إلى `users`)، والتشغيلُ المجدول
 * يعمل بتفويض المالك وصلاحيّاته — فمعرّفُه هو الذي يُكتب، كما يستعيره وضعُ التجربة.
 * ولكي لا يُقرأ القيدُ فعلاً وقع من المالك بيده، يُوسَم كلُّ ما يكتبه `recordAudit`
 * داخل هذا السياق بـ`"المنفّذ": "system:cron"` — بلا تمريرٍ في كلّ خدمة.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ label: string }>();

/** اسمُ الفاعل الآليّ في سجلّ التدقيق. */
export const CRON_ACTOR_LABEL = "system:cron";
/**
 * الاستدراكُ الخلفيّ من القشرة (`components/auto-process.tsx`): يجري بجلسة من فتح
 * الصفحة، لكنّه لم يضغط شيئاً — فيُوسَم كالمجدول. والضغطُ بيدٍ يبقى باسم صاحبه.
 */
export const BACKGROUND_ACTOR_LABEL = "system:background";

/** يجري العملَ باسم النظام إن كان خلفيّاً، وإلّا كما هو. */
export function runAsSystemIf<T>(background: boolean, fn: () => Promise<T>): Promise<T> {
  return background ? runAsSystem(BACKGROUND_ACTOR_LABEL, fn) : fn();
}

export function runAsSystem<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ label }, fn);
}

/** الفاعلُ الآليّ الجاري — `null` حين يفعل إنسانٌ بجلسته. */
export function systemActorLabel(): string | null {
  return store.getStore()?.label ?? null;
}
