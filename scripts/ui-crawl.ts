/**
 * زاحفُ الواجهة — «لا طريقَ مسدوداً» مفحوصٌ آلياً لا بالعين.
 *
 *   npm run ui:crawl                      (خادمُ التطوير على :3000، وضعُ التجربة)
 *   BASE=http://localhost:3100 npm run ui:crawl
 *   npm run ui:crawl -- --quick           (الحاسوبُ الفاتح وحده)
 *   CRAWL_ROLE=ACCOUNTANT npm run ui:crawl  (خادمٌ بـ`AUTH_BYPASS_ROLE` نفسه)
 *
 * يبدأ من كلّ مسارٍ في نموذج التنقّل ولوحة الأوامر، ثمّ يتبع كلَّ رابطٍ
 * داخليٍّ يجده في الصفحات (بعرضٍ واحد)، ثمّ يزور كلَّ ما وجده بأربعة
 * أوجه: حاسوب ١٤٤٠ وجوّال ٣٩٠، فاتحاً وداكناً. ولكلّ صفحة:
 *
 *   - الحالُ دون ٤٠٠، ولا خطأ في الطرفيّة ولا في الصفحة، ولا طلبٌ فاشل.
 *   - ليست فارغة: عنوانٌ `h1` ونصٌّ يُقرأ.
 *   - لا `href="#"` ولا رابطٌ بلا وجهة، ولا زرٌّ أو حقلٌ بلا اسمٍ يُقرأ.
 *   - لا فيضَ عرضاً على الجوّال (الصفحةُ لا تُسحب جانبياً).
 *   - وبدورٍ غير المالك (`CRAWL_ROLE`): يبدأ ممّا يراه الدورُ وحده، فكلُّ صفحةٍ
 *     تقول «خارج صلاحيتك» أو تُحوِّل إلى غيرها وصلها رابطٌ ظاهرٌ له — طريقٌ مسدود.
 *
 * ولا يضغط زرّاً ولا يرسل نموذجاً — يقرأ فقط، فيصلح لقاعدة المعاينة وحدها.
 * ويخرج بـ١ إن وجد شيئاً، ويكتب التقرير في `.scratch/crawl-report.json`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { entryHref, visibleAccountLinks, visibleAreas, visibleChildren } from "@/lib/nav";
import { commandsFor } from "@/lib/commands";
import type { Role } from "@/lib/permissions";

const BASE = process.env.BASE ?? "http://localhost:3000";
const QUICK = process.argv.includes("--quick");
const MAX_PAGES = Number(process.env.CRAWL_MAX ?? 120);
const ROLE: Role = process.env.CRAWL_ROLE === "ACCOUNTANT" || process.env.CRAWL_ROLE === "PURCHASING" ? process.env.CRAWL_ROLE : "OWNER";

/** مساراتٌ لا يُزحَف إليها: التنزيلاتُ والواجهاتُ والخروج. */
const SKIP = [/^\/api\//, /^\/login/, /\.(csv|xlsx|pdf|png|jpg|svg|ico|webmanifest)$/i];

type Variant = { name: string; width: number; height: number; scheme: "light" | "dark"; mobile: boolean };
const VARIANTS: Variant[] = [
  { name: "desktop-light", width: 1440, height: 900, scheme: "light", mobile: false },
  { name: "desktop-dark", width: 1440, height: 900, scheme: "dark", mobile: false },
  { name: "mobile-light", width: 390, height: 844, scheme: "light", mobile: true },
  { name: "mobile-dark", width: 390, height: 844, scheme: "dark", mobile: true },
];

interface Finding {
  route: string;
  variant: string;
  problem: string;
  /** أوّلُ صفحةٍ دلّت عليه — موضعُ الإصلاح حين يكون الرابطُ نفسُه هو العطب. */
  from?: string;
}

/** مسارٌ له صفحة — `owns` بادئاتٌ قد لا تكون صفحاتٍ (`/inventory/counts` لـ`/inventory/counts/[id]`). */
function isPage(path: string): boolean {
  const file = path === "/" ? "src/app/(app)/(home)/page.tsx" : `src/app/(app)${path}/page.tsx`;
  return existsSync(file);
}

/** ما يراه الدورُ وحده: مساحاتُه وألسنتُها وروابطُ حسابه وأوامرُ لوحته. */
function seeds(): string[] {
  const out = new Set<string>(ROLE === "OWNER" ? ["/"] : []);
  for (const a of visibleAreas(ROLE)) {
    out.add(entryHref(ROLE, a));
    for (const c of visibleChildren(ROLE, a)) out.add(c.href);
    if (ROLE === "OWNER") for (const o of a.owns) out.add(o);
  }
  for (const l of visibleAccountLinks(ROLE)) out.add(l.href);
  /* أوامرُ العرض (`event`) تُطلق فعلاً في الصفحة ولا تنتقل — ليست وجهات */
  for (const c of commandsFor(ROLE)) if (!c.event) out.add(c.href.split("#")[0]);
  return [...out].filter(isPage);
}

/**
 * الرابطُ يُقرأ نسبةً إلى الصفحة التي هو فيها لا إلى الجذر: «#manual» في
 * صفحة الدرايف كان يُقرأ «/» فيُعَدّ رابطاً إلى «اليوم».
 */
function normalize(href: string, from: string): string | null {
  try {
    const u = new URL(href, BASE + from);
    if (u.origin !== new URL(BASE).origin) return null;
    if (SKIP.some((re) => re.test(u.pathname))) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

interface Facts {
  textLength: number;
  h1: string;
  deadLinks: string[];
  unnamedButtons: string[];
  unnamedFields: string[];
  overflow: number;
  links: string[];
  noAccess: boolean;
}

const FACTS_SCRIPT = `(() => {
  const main = document.querySelector("main");
  const text = (main && main.textContent || "").replace(/\\s+/g, " ").trim();
  const h1el = document.querySelector("main h1");
  const h1 = h1el && h1el.textContent ? h1el.textContent.trim() : "";
  const deadLinks = Array.from(document.querySelectorAll("a"))
    .filter(function (a) { const h = a.getAttribute("href"); return h === null || h === "" || h === "#"; })
    .map(function (a) { return (a.textContent || "").trim().slice(0, 40) || a.outerHTML.slice(0, 60); });
  const nameOf = function (el) {
    return (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || "").trim();
  };
  const unnamedButtons = Array.from(document.querySelectorAll("button"))
    .filter(function (b) { return b.offsetParent !== null && !nameOf(b) && !b.getAttribute("aria-labelledby"); })
    .map(function (b) { return b.outerHTML.slice(0, 80); });
  const unnamedFields = Array.from(document.querySelectorAll("input, select, textarea"))
    .filter(function (el) {
      if (el.type === "hidden" || el.offsetParent === null) return false;
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
      if (el.closest("label")) return false;
      return !(el.id && document.querySelector('label[for="' + el.id + '"]'));
    })
    .map(function (f) { return f.outerHTML.slice(0, 80); });
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const links = Array.from(document.querySelectorAll("a[href]")).map(function (a) { return a.getAttribute("href") || ""; });
  /* الصفحةُ كلُّها خارج الصلاحية (\`NoAccess\`) — لا جملةٌ تقول إنّ جزءاً منها كذلك */
  const noAccess = document.querySelector("main [data-no-access]") !== null;
  return { textLength: text.length, h1: h1, deadLinks: deadLinks, unnamedButtons: unnamedButtons, unnamedFields: unnamedFields, overflow: overflow, links: links, noAccess: noAccess };
})()`;

async function inspect(page: Page, route: string, variant: Variant, collectLinks: boolean): Promise<{ findings: Finding[]; links: string[] }> {
  const findings: Finding[] = [];
  const add = (problem: string) => findings.push({ route, variant: variant.name, problem });
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); };
  const onPageError = (e: Error) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`);
  const onResponse = (r: { status(): number; url(): string; request(): { method(): string } }) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90_000 });
    const status = res?.status() ?? 0;
    if (status >= 400 || status === 0) add(`HTTP ${status}`);
    await page.waitForTimeout(250);
    /* رابطٌ يُحوِّل إلى غير وجهته — لدورٍ لا يملكها، أو وجهةٌ لم تعد موجودة */
    /* (والمالكُ يُزار بمساراتٍ قديمةٍ تُحوِّل عمداً — `owns` — فيُفحص التحويلُ لغيره) */
    const landed = new URL(page.url()).pathname;
    if (ROLE !== "OWNER" && landed !== route.split("?")[0] && !landed.startsWith("/login")) add(`يُحوِّل إلى ${landed}`);

    /*
      نصٌّ لا دالّة: مُشغّلُ TypeScript يُلحق بالدوالّ المسمّاة مساعداً (`__name`)
      لا وجود له في المتصفّح، فتسقط كلُّ صفحة بـReferenceError.
    */
    const facts = (await page.evaluate(FACTS_SCRIPT)) as Facts;

    if (facts.noAccess) add(`«خارج صلاحيتك» لدور ${ROLE} — وصلها رابطٌ ظاهرٌ له`);
    if (!facts.h1) add("لا عنوان h1 في المحتوى");
    if (facts.textLength < 40) add(`صفحةٌ شبه فارغة (${facts.textLength} حرفاً)`);
    for (const d of facts.deadLinks) add(`رابطٌ بلا وجهة: ${d}`);
    for (const b of facts.unnamedButtons) add(`زرٌّ بلا اسم: ${b}`);
    for (const f of facts.unnamedFields) add(`حقلٌ بلا اسم: ${f}`);
    if (variant.mobile && facts.overflow > 1) add(`تفيض الصفحةُ عرضاً بـ${facts.overflow}px`);
    for (const e of consoleErrors) add(`طرفيّة: ${e}`);
    for (const f of failed) add(`طلبٌ فاشل: ${f}`);

    const links = collectLinks
      ? facts.links.map((l) => normalize(l, route)).filter((x): x is string => x !== null)
      : [];
    return { findings, links };
  } catch (e) {
    add(`تعذّر الفتح: ${(e as Error).message.slice(0, 160)}`);
    return { findings, links: [] };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const findings: Finding[] = [];

  /* ── الاكتشاف: الحاسوبُ الفاتح يتبع الروابط ── */
  const [first, ...rest] = VARIANTS;
  const ctx = await browser.newContext({ viewport: { width: first.width, height: first.height }, colorScheme: first.scheme, locale: "ar-SA" });
  const page = await ctx.newPage();
  const queue = seeds();
  const seen = new Set<string>();
  /* مسارٌ بمعاملاتٍ مختلفة صفحةٌ واحدة في الغالب — يُزار أوّلُ ثلاثة لكلّ مسار */
  const perPath = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const route = queue.shift()!;
    if (seen.has(route)) continue;
    const path = route.split("?")[0];
    const n = perPath.get(path) ?? 0;
    if (n >= 3) continue;
    perPath.set(path, n + 1);
    seen.add(route);
    const r = await inspect(page, route, first, true);
    findings.push(...r.findings.map((f) => ({ ...f, from: cameFrom.get(route) ?? "(بذرة)" })));
    for (const l of r.links) {
      if (seen.has(l)) continue;
      if (!cameFrom.has(l)) cameFrom.set(l, route);
      queue.push(l);
    }
    process.stdout.write(`${r.findings.length ? "✕" : "✓"} ${first.name} ${route}\n`);
  }
  await ctx.close();

  /* ── بقيّةُ الأوجه على ما اكتُشف ── */
  if (!QUICK) {
    for (const v of rest) {
      const c = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        colorScheme: v.scheme,
        isMobile: v.mobile,
        hasTouch: v.mobile,
        locale: "ar-SA",
      });
      const p = await c.newPage();
      for (const route of seen) {
        const r = await inspect(p, route, v, false);
        findings.push(...r.findings);
        process.stdout.write(`${r.findings.length ? "✕" : "✓"} ${v.name} ${route}\n`);
      }
      await c.close();
    }
  }
  await browser.close();

  mkdirSync(".scratch", { recursive: true });
  writeFileSync(ROLE === "OWNER" ? ".scratch/crawl-report.json" : `.scratch/crawl-report-${ROLE}.json`, JSON.stringify({ base: BASE, pages: [...seen], findings }, null, 2));

  console.log(`\nزُحف إلى ${seen.size} صفحة${QUICK ? "" : ` × ${VARIANTS.length} أوجه`}. ما وُجد: ${findings.length}.`);
  const grouped = new Map<string, string[]>();
  for (const f of findings) grouped.set(f.problem, [...(grouped.get(f.problem) ?? []), `${f.route} (${f.variant})${f.from ? ` ← ${f.from}` : ""}`]);
  for (const [problem, where] of grouped) console.log(`\n✕ ${problem}\n   ${where.slice(0, 6).join("\n   ")}${where.length > 6 ? `\n   … و${where.length - 6} غيرها` : ""}`);
  process.exit(findings.length ? 1 : 0);
}

void main();
