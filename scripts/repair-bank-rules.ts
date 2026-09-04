/**
 * إصلاح قواعد تصنيف الحركات البنكية.
 *
 *   npm run db:repair-rules            معاينة
 *   npm run db:repair-rules -- --commit
 *
 * القواعد التي صنّفها المالك حُفظت بنمط يحمل رقم السداد والمرجع الخاصّ
 * بتلك العملية بعينها: «energy السداد30151604771 سداد6959405843 مرجع107128929».
 * وفاتورة الكهرباء القادمة مرجعها مختلف، فلا تُطابَق — والتصنيف الذي بذل
 * فيه المالك جهداً لا يعمل إلا مرّة واحدة.
 *
 * هنا يُعاد اشتقاق النمط بعد إسقاط الأرقام وركام البنك، ثمّ تُدمج المتشابهات.
 * والتعارض لا يُحسم بصمت: يُعرض ليراه صاحبه.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bankRules } from "@/db/schema";
import { suggestAlias } from "@/lib/bank/match";
import { normalizeName } from "@/lib/suppliers-seed";

const commit = process.argv.includes("--commit");

async function main() {
  const rows = await db
    .select({
      id: bankRules.id, pattern: bankRules.pattern, normalized: bankRules.normalized,
      category: bankRules.category, supplierId: bankRules.supplierId,
      note: bankRules.note, createdAt: bankRules.createdAt,
    })
    .from(bankRules)
    .orderBy(bankRules.createdAt);

  interface Group {
    pattern: string;
    normalized: string;
    categories: Map<string, number>;
    latestCategory: string;
    supplierId: string | null;
    note: string | null;
    sources: string[];
  }

  const groups = new Map<string, Group>();
  const unchanged: string[] = [];

  for (const r of rows) {
    const cleaned = suggestAlias(r.pattern, 5).trim();
    // ما لم يبقَ منه شيء يُترك كما هو — الحذف أسوأ من نمط ضيّق
    const pattern = cleaned.length >= 3 ? cleaned : r.pattern;
    const normalized = normalizeName(pattern);
    if (normalized === r.normalized) unchanged.push(r.pattern);

    const g = groups.get(normalized) ?? {
      pattern, normalized,
      categories: new Map<string, number>(),
      latestCategory: r.category,
      supplierId: r.supplierId,
      note: r.note,
      sources: [],
    };
    g.categories.set(r.category, (g.categories.get(r.category) ?? 0) + 1);
    g.latestCategory = r.category; // الصفوف مرتّبة بالأقدم فالأحدث
    if (r.supplierId) g.supplierId = r.supplierId;
    if (r.note) g.note = r.note;
    g.sources.push(r.pattern);
    groups.set(normalized, g);
  }

  const conflicts: Group[] = [];
  const final = [...groups.values()].map((g) => {
    if (g.categories.size > 1) conflicts.push(g);
    // الأكثر تكراراً، وعند التساوي فالأحدث — ولا يُحسم بصمت بل يُعرض
    const ranked = [...g.categories].sort((a, b) => b[1] - a[1]);
    const category =
      ranked.length > 1 && ranked[0][1] === ranked[1][1] ? g.latestCategory : ranked[0][0];
    return { ...g, category };
  });

  console.log(`\nقواعد قبل: ${rows.length}   بعد الدمج: ${final.length}   لم تتغيّر: ${unchanged.length}\n`);
  console.log("── الأنماط بعد التنظيف ──");
  for (const g of final.sort((a, b) => a.category.localeCompare(b.category))) {
    const from = g.sources.length > 1 ? `  (دُمج ${g.sources.length})` : "";
    console.log(`  ${g.category.padEnd(12)} «${g.pattern}»${from}`);
    if (g.sources.length > 1 || g.sources[0] !== g.pattern) {
      for (const src of g.sources) console.log(`               ← ${src}`);
    }
  }

  if (conflicts.length) {
    console.log(`\n── ⚠ تعارض في التصنيف بعد الدمج ──`);
    for (const c of conflicts) {
      console.log(`  «${c.pattern}»: ${[...c.categories].map(([k, v]) => `${k}×${v}`).join("، ")}`);
    }
    console.log("  حُسم بالأكثر تكراراً، وعند التساوي بالأحدث. راجعه بنفسك.");
  }

  if (!commit) {
    console.log("\nمعاينة فقط — أضف --commit.\n");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.delete(bankRules).where(sql`true`);
    for (const g of final) {
      await tx.insert(bankRules).values({
        pattern: g.pattern,
        normalized: g.normalized,
        category: g.category as never,
        supplierId: g.category === "SUPPLIER" ? g.supplierId : null,
        note: g.note,
        source: "MANUAL",
      }).onConflictDoNothing();
    }
  });

  console.log(`\n✓ ${final.length} قاعدة، أنماطها تعمّ ما يشبهها لا عمليةً واحدة.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
