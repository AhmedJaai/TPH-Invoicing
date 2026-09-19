/**
 * جمعُ ما في المستودع لبناء الدليل — لا يُكتب رقمٌ باليد.
 *
 * الدليلُ الذي يُكتب فيه «٤٢ جدولاً» بيدٍ يصير كذباً عند أوّل جدول
 * يُضاف. فكلُّ عددٍ وكلُّ جدولٍ وكلُّ مسارٍ في هذا الدليل يُقرأ من
 * الشيفرة نفسها لحظةَ التوليد — ومن غيّر الشيفرة وأعاد التوليد وجد
 * الدليل مطابقاً.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface FileInfo {
  file: string;
  lines: number;
  /** أوّل سطرٍ من تعليق الرأس — وهو في هذا المستودع يقول ما الملفّ. */
  doc: string;
  exports: string[];
  imports: string[];
  isClient: boolean;
}

export interface TableInfo {
  name: string;
  table: string;
  cols: { ts: string; kind: string; col: string }[];
}

export interface ApiInfo {
  route: string;
  methods: string[];
  guardName: string | null;
  capability: string | null;
  doc: string;
  fields: string[];
  runtime: string;
  maxDur: string;
}

export interface PageInfo {
  route: string;
  title: string;
  intro: string;
  doc: string;
  width: string;
  redirectTo: string | null;
  components: string[];
  deps: string[];
}

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, match));
    else if (match.test(p)) out.push(p);
  }
  return out.sort();
}

const firstDocLine = (s: string) => s.match(/\/\*\*\s*\n\s*\*\s*(.+)/)?.[1]?.trim() ?? "";

export function collectFiles(): FileInfo[] {
  return walk("src", /\.(ts|tsx)$/)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => {
      const src = readFileSync(f, "utf8");
      return {
        file: f,
        lines: src.split("\n").length,
        doc: firstDocLine(src),
        exports: [...src.matchAll(/^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm)].map((m) => m[1]),
        imports: [...new Set([...src.matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]))],
        isClient: src.startsWith(`"use client"`),
      };
    });
}

/**
 * عددُ الاختبارات — من `vitest` نفسِه لا من عدِّ `it(` في النصّ.
 *
 * فالعدُّ النصّيّ يُسقط ما يُولَّد في حلقة (`it.each`) ويُسقط ما يُكرَّر
 * بمعاملات — قاس ١٥١٨ و`vitest` يقول ١٩٤٥. **ورقمٌ في دليلٍ يخالف ما
 * يطبعه المشغّل أسوأ من ألّا يُذكر**: من يقرؤه يحسِب أنّ مئاتِ
 * الاختبارات ناقصة.
 *
 * وإن تعذّر التشغيل رجع إلى العدّ النصّيّ **وأعلن أنّه تقدير**.
 */
export function collectTests(): { files: number; cases: number; exact: boolean } {
  const files = walk("src", /\.test\.tsx?$/);
  try {
    const out = execSync("npx vitest run --reporter=dot 2>&1", {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000,
    });
    const m = out.match(/Tests\s+(\d+)\s+passed/);
    if (m) return { files: files.length, cases: Number(m[1]), exact: true };
  } catch {
    /* المشغّل غير متاح — يُقال إنّه تقدير */
  }
  let cases = 0;
  for (const f of files) cases += (readFileSync(f, "utf8").match(/^\s*(it|test)[.(]/gm) ?? []).length;
  return { files: files.length, cases, exact: false };
}

export function collectSchema() {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const tables: TableInfo[] = [...schema.matchAll(/export const (\w+) = pgTable\("([^"]+)",\s*\{([\s\S]*?)\n\}/g)].map((m) => ({
    name: m[1],
    table: m[2],
    cols: [...m[3].matchAll(/^\s{2}(\w+):\s*(\w+)\("([^"]+)"/gm)].map((c) => ({ ts: c[1], kind: c[2], col: c[3] })),
  }));
  const enums = [...schema.matchAll(/export const (\w+) = pgEnum\("([^"]+)",\s*\[([\s\S]*?)\]\)/g)].map((m) => ({
    name: m[1],
    pg: m[2],
    values: [...m[3].matchAll(/"([^"]+)"/g)].map((v) => v[1]),
  }));
  return { tables, enums };
}

export function collectPermissions() {
  const perms = readFileSync("src/lib/permissions.ts", "utf8");
  const caps = [...perms.matchAll(/"([a-z]+:[a-z]+)":\s*"([^"]+)"/g)].map((m) => ({ cap: m[1], label: m[2] }));
  const roles = [...perms.matchAll(/^\s{2}(OWNER|ACCOUNTANT|PURCHASING):\s*\[([\s\S]*?)\],/gm)].map((m) => ({
    role: m[1],
    caps: [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1]),
  }));
  return { caps, roles };
}

export function collectAuditActions(): string[] {
  const s = readFileSync("src/lib/audit.ts", "utf8");
  const block = s.match(/export type AuditAction =([\s\S]*?);/)?.[1] ?? "";
  return [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function collectApi(): ApiInfo[] {
  return walk("src/app/api", /route\.ts$/).map((f) => {
    const s = readFileSync(f, "utf8");
    const guard = s.match(/guard\("([^"]+)",\s*"([^"]+)"\)/);
    const body = s.match(/interface Body \{([\s\S]*?)\n\}/);
    return {
      route: "/" + path.relative("src/app", path.dirname(f)).replace(/\\/g, "/"),
      methods: [...s.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]),
      guardName: guard?.[1] ?? null,
      capability: guard?.[2] ?? null,
      doc: firstDocLine(s),
      fields: body ? [...body[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1]) : [],
      runtime: s.match(/export const runtime = "(\w+)"/)?.[1] ?? "—",
      maxDur: s.match(/export const maxDuration = (\d+)/)?.[1] ?? "—",
    };
  });
}

export function collectPages(): PageInfo[] {
  return walk("src/app", /page\.tsx$/).map((f) => {
    const s = readFileSync(f, "utf8");
    const route = "/" + path.relative("src/app", path.dirname(f)).replace(/\\/g, "/");
    return {
      route: route === "/." ? "/" : route.replace(/\/\.$/, "/"),
      title: s.match(/title="([^"]+)"/)?.[1] ?? s.match(/title=\{`([^`]+)`\}/)?.[1] ?? "",
      intro: s.match(/intro="([^"]+)"/)?.[1] ?? "",
      doc: firstDocLine(s),
      width: s.match(/width="(\w+)"/)?.[1] ?? "page",
      redirectTo: s.match(/permanentRedirect\("([^"]+)"\)/)?.[1] ?? null,
      components: [...new Set([...s.matchAll(/from "@\/components\/([\w-]+)"/g)].map((m) => m[1]))],
      deps: [...new Set([...s.matchAll(/from "@\/(services|lib)\/([\w/-]+)"/g)].map((m) => `${m[1]}/${m[2]}`))],
    };
  });
}

export function collectMigrations(): { file: string; title: string }[] {
  return readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort().map((f) => {
    const s = readFileSync(path.join("drizzle/sql", f), "utf8");
    /* عنوانُ الهجرة أوّلُ سطرِ تعليقٍ ذي معنى فيها */
    const title = s.split("\n").map((l) => l.replace(/^--\s?/, "").trim())
      .find((l) => l && !/^[═─=-]+$/.test(l)) ?? "";
    return { file: f, title };
  });
}

/** كلُّ زرٍّ ورابطٍ في الواجهة، وما يستدعيه. */
export function collectActions(): { file: string; label: string; kind: string; target: string }[] {
  const out: { file: string; label: string; kind: string; target: string }[] = [];
  for (const f of walk("src", /\.tsx$/).filter((f) => !/\.test\./.test(f))) {
    const s = readFileSync(f, "utf8");
    /* الفعلُ الذي ينادي الخادم — ومسارُه هو ما يفعله حقّاً */
    for (const m of s.matchAll(/(?:postJson|request)<[^>]*>?\(\s*"([^"]+)"/g)) {
      out.push({ file: f, label: "", kind: "نداء", target: m[1] });
    }
    for (const m of s.matchAll(/postJson\(\s*"([^"]+)"/g)) {
      out.push({ file: f, label: "", kind: "نداء", target: m[1] });
    }
  }
  return out;
}
