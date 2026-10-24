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

export function runAsSystem<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ label }, fn);
}

/** الفاعلُ الآليّ الجاري — `null` حين يفعل إنسانٌ بجلسته. */
export function systemActorLabel(): string | null {
  return store.getStore()?.label ?? null;
}
