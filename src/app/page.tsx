import { redirect } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, suppliers } from "@/db/schema";
import { Uploader } from "@/components/uploader";
import { UserMenu } from "@/components/user-menu";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { activeProviderName } from "@/lib/extraction";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`nums mt-1 text-xl font-bold ${tone === "warn" ? "text-warn" : ""}`}>{value}</p>
    </div>
  );
}

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const showAmounts = can(user.role, "amounts:view");

  const rows = await db
    .select({
      slug: suppliers.slug,
      nameAr: suppliers.nameAr,
      issuesInvoices: suppliers.issuesInvoices,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  const [{ value: archivedCount }] = await db
    .select({ value: count() })
    .from(documents)
    .where(eq(documents.status, "ARCHIVED"));

  const needContract = rows.filter((s) => !s.issuesInvoices).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold leading-tight">
              فواتير ذا بوبليك هاوس
            </p>
            <p className="truncate text-[11px] text-muted">الرقم الضريبي ٣١٠٠٠٧٩٧١٦٠٠٠٠٣</p>
          </div>
          <UserMenu name={user.name} role={user.role} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <h1 className="font-display text-3xl font-black leading-tight sm:text-4xl">
          كل فاتورة في مكانها،
          <br />
          من أول يوم.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          ارفع الفاتورة كما وصلتك من واتساب — باسمها العشوائي أو صورةً بجوالك. يقرأ النظام
          المستند نفسه، ويستخرج المورد والرقم والتاريخ والمبالغ، ويسمّيه ويحدّد مجلده،
          ويعرض كل ذلك للتعديل قبل أن يُحفظ شيء.
        </p>

        <div className="mt-8">
          <Uploader canSeeAmounts={showAmounts} />
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-bold">حالة النظام</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="الموردون" value={String(rows.length)} />
            <Stat
              label="يحتاجون عقد توريد"
              value={String(needContract)}
              tone={needContract > 0 ? "warn" : undefined}
            />
            <Stat label="مستندات مؤرشفة" value={String(archivedCount)} />
            <Stat label="قارئ الفواتير" value={activeProviderName()} />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-bold">الموردون المسجّلون</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {rows.map((s) => (
              <li key={s.slug} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm">{s.nameAr}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {!s.issuesInvoices && (
                    <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-bold text-warn">
                      بلا فواتير
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-muted" dir="ltr">
                    {s.slug}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          {showAmounts
            ? "لك صلاحية الاطلاع على الأرقام المالية."
            : "دورك لا يشمل الأرقام المالية — تظهر لك المستندات دون مبالغها."}
        </footer>
      </main>
    </div>
  );
}
