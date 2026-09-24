/**
 * الأيقونات — مجموعةٌ واحدة (lucide) بخطٍّ واحد (‎1.75‎)، لا رسومٌ متفرّقة.
 *
 * كانت كلُّ شاشةٍ ترسم رموزها بيدها، فالجردُ دائرةٌ فارغة والإعداداتُ
 * وسجلُّ التدقيق رمزان متطابقان. والآن لكلّ مساحةٍ رمزُها المعروف في
 * موضعٍ واحد، والأيقونةُ لا تأتي بلا اسمٍ ظاهر أو `aria-label`.
 *
 * مكوّناتٌ بلا حالة تصلح للخادم والمتصفّح معاً.
 */
import {
  Bell, Boxes, CalendarCheck, FileText, Inbox, Landmark, ScrollText, Settings, Store, Sun, Wallet,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/nav";

export const NAV_ICON: Record<NavIcon, LucideIcon> = {
  today: Sun,
  decisions: Inbox,
  documents: FileText,
  suppliers: Store,
  payments: Wallet,
  bank: Landmark,
  close: CalendarCheck,
  inventory: Boxes,
  settings: Settings,
  audit: ScrollText,
};

export function NavGlyph({ icon, className = "h-[18px] w-[18px]" }: { icon: NavIcon; className?: string }) {
  const Icon = NAV_ICON[icon];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}

export { Bell };

/** علامةُ المقهى: فنجانٌ في مربّعٍ مستدير بلون العلامة. */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[10px] bg-frame-accent text-frame ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
        <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" />
        <path d="M8 3.5c0 1.2 1 1.3 1 2.5M12 3.5c0 1.2 1 1.3 1 2.5" />
      </svg>
    </span>
  );
}
