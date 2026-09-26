import { PageShell, type ShellWidth } from "./page-shell";
import { InspectorPanel } from "./inspector";
import type { Role } from "@/lib/permissions";

/**
 * إطارُ ملفّ السجلّ — صفحةً كاملة، أو لوحاً فوق القائمة.
 *
 * الملفُّ واحد (المورّد · الفاتورة · الصنف · حركة البنك) ويُرسَم في موضعين:
 * `page` حين يُحمَّل رابطُه مباشرةً، و`drawer` حين يُفتح من قائمة (مسارٌ
 * معترِض في `(app)/@drawer`). فلا يُكتب الملفُّ مرّتين ولا يفترقان.
 * ومتنُه يُصمَّم بمقاس وعائه (`@container`) لا بمقاس الشاشة، فيصحّ في الموضعين.
 */
export type DetailMode = "page" | "drawer";

export function DetailFrame({
  mode,
  user,
  title,
  eyebrow,
  intro,
  actions,
  width = "wide",
  fullHref,
  children,
}: {
  mode: DetailMode;
  user: { name?: string | null; role: Role };
  title: string;
  eyebrow?: React.ReactNode;
  intro?: string;
  actions?: React.ReactNode;
  width?: ShellWidth;
  fullHref: string;
  children: React.ReactNode;
}) {
  if (mode === "drawer") {
    return (
      <InspectorPanel title={title} eyebrow={eyebrow} intro={intro} actions={actions} fullHref={fullHref}>
        {children}
      </InspectorPanel>
    );
  }
  return (
    <PageShell user={user} width={width} title={title} eyebrow={eyebrow} intro={intro} actions={actions}>
      {children}
    </PageShell>
  );
}
