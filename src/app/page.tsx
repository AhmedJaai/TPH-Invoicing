import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { asc } from "drizzle-orm";
import { Uploader } from "@/components/uploader";
import type { SupplierRef } from "@/components/analyzer";

export const dynamic = "force-dynamic";

async function loadSuppliers(): Promise<
  { ok: true; rows: SupplierRef[] } | { ok: false; message: string }
> {
  try {
    const rows = await db
      .select({
        slug: suppliers.slug,
        nameAr: suppliers.nameAr,
        driveFolderName: suppliers.driveFolderName,
        issuesInvoices: suppliers.issuesInvoices,
      })
      .from(suppliers)
      .orderBy(asc(suppliers.nameAr));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`nums mt-1 text-xl font-bold ${tone === "warn" ? "text-warn" : ""}`}>{value}</p>
    </div>
  );
}

export default async function Home() {
  const data = await loadSuppliers();
  const rows = data.ok ? data.rows : [];
  const needContract = rows.filter((s) => !s.issuesInvoices).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold leading-tight">
              فواتير ذا بوبليك هاوس
            </p>
            <p className="truncate text-[11px] text-muted">الرقم الضريبي ٣١٠٠٠٧٩٧١٦٠٠٠٠٣</p>
          </div>
          <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft">
            المرحلة صفر
          </span>
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
          {data.ok ? (
            <Uploader />
          ) : (
            <div className="rounded-xl border border-line bg-danger-bg p-4 text-sm text-danger">
              تعذّر الاتصال بقاعدة البيانات: {data.message}
            </div>
          )}
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-bold">حالة النظام</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="الموردون" value={data.ok ? String(rows.length) : "—"} />
            <Stat
              label="يحتاجون عقد توريد"
              value={data.ok ? String(needContract) : "—"}
              tone={needContract > 0 ? "warn" : undefined}
            />
            <Stat label="قاعدة البيانات" value={data.ok ? "تعمل" : "متوقفة"} />
            <Stat label="أرشيف الدرايف" value="قراءة فقط" />
          </div>
        </section>

        {data.ok && rows.length > 0 && (
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
        )}

        <footer className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          لم يُرفع ولم يُعدَّل ولم يُحذف أي ملف في الدرايف. الخطوة التالية إعداد بيانات جوجل،
          ودليلها في ملف README.
        </footer>
      </main>
    </div>
  );
}
