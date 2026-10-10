import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * «كلُّ واجهةٍ تبدأ بـ`guard(route, capability)`، والكتابةُ بصلاحيةٍ غير صلاحية
 * القراءة» — مفحوصةً لكلّ مسار لا بالثقة.
 *
 * لا اختبارَ يستدعي معالجاً (يلزمه جلسةٌ وقاعدة)، فكان مسارٌ جديد ينسى الحارس، أو
 * يحرس كتابةً بـ`bank:view`، يمرّ من كلّ فحص. فتُقرأ شجرةُ كلّ `route.ts`: لكلّ
 * معالجٍ مصدَّر تُجمَع نداءاتُ `guard` فيه وفي الدوالّ المحلّيّة التي يستدعيها.
 */
const API = path.join("src", "app", "api");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const METHODS = new Set(["GET", "HEAD", ...MUTATING]);

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routes(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out.sort();
}

export interface HandlerGuards {
  method: string;
  /** صلاحيّاتُ نداءات `guard` التي يبلغها المعالج — `null` لما ليس نصّاً حرفيّاً */
  capabilities: (string | null)[];
}

/** لكلّ معالجٍ مصدَّر: ما يبلغه من نداءات `guard`، مباشرةً أو عبر دوالّ الملفّ. */
export function handlerGuards(source: string, fileName = "route.ts"): HandlerGuards[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /* دوالُّ الملفّ بأسمائها: تصريحٌ أو ثابتٌ قيمتُه دالّة */
  const local = new Map<string, ts.Node>();
  const exported = new Map<string, ts.Node>();
  const isExported = (n: ts.Node) =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      local.set(stmt.name.text, stmt);
      if (isExported(stmt) && METHODS.has(stmt.name.text)) exported.set(stmt.name.text, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        local.set(d.name.text, d.initializer);
        if (isExported(stmt) && METHODS.has(d.name.text)) exported.set(d.name.text, d.initializer);
      }
    }
  }

  const reach = (start: ts.Node): (string | null)[] => {
    const caps: (string | null)[] = [];
    const seen = new Set<ts.Node>();
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "guard") {
        const cap = n.arguments[1];
        caps.push(cap && ts.isStringLiteralLike(cap) ? cap.text : null);
      }
      /* اسمُ دالّةٍ محلّيّة — مستدعاةً أو ممرَّرةً (`withDeadline(handle)`، `export const POST = handle`) */
      if (ts.isIdentifier(n)) {
        const target = local.get(n.text);
        if (target && !seen.has(target)) {
          seen.add(target);
          visit(target);
        }
      }
      ts.forEachChild(n, visit);
    };
    seen.add(start);
    visit(start);
    return caps;
  };

  return [...exported.entries()].map(([method, node]) => ({ method, capabilities: reach(node) }));
}

/**
 * مساراتٌ بلا `guard` — ولكلٍّ سببُه.
 */
const UNGUARDED: Record<string, string> = {
  "src/app/api/health/route.ts": "فحصُ الحياة علنيّ عمداً: المجهولُ يرى «حيّ أو لا» وحده، والتفصيلُ بـaudit:view داخله",
  "src/app/api/auth/[...nextauth]/route.ts": "بابُ الدخول نفسُه — Auth.js",
};

/**
 * كتابةٌ تُحرَس بصلاحيّة قراءة — ولكلٍّ سببُه. ما ليس هنا فيلزمه `:edit` أو ما فوقها.
 */
const WRITE_WITH_VIEW: Record<string, string> = {
  "src/app/api/notifications/route.ts POST": "يكتب حدَّ القراءة للمستخدم نفسِه وحده — لا مال ولا قرار",
};

const isReadOnly = (capability: string) => /:view$/.test(capability);
const posix = (file: string) => file.split(path.sep).join("/");

describe("كلُّ مسارٍ يبدأ بحارس، والكتابةُ بغير صلاحية القراءة", () => {
  const files = routes(API);

  it("الحارس يرى المسارات فعلاً", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    const key = posix(file);
    const handlers = handlerGuards(readFileSync(file, "utf8"), file);

    /* باب الدخول يصدّر معالجَيه تفكيكاً من Auth.js — لا دالّةً تُقرأ هنا */
    if (!(key in UNGUARDED)) {
      it(`${key} يصدّر معالجاً`, () => {
        expect(handlers.length).toBeGreaterThan(0);
      });
    }

    for (const h of handlers) {
      it(`${key} ${h.method}`, () => {
        if (key in UNGUARDED) {
          expect(h.capabilities, `${key} في UNGUARDED وهو يحمل حارساً — احذفه منها`).toEqual([]);
          return;
        }
        expect(h.capabilities.length, `${h.method} لا يبلغ نداءَ guard(route, capability)`).toBeGreaterThan(0);
        expect(h.capabilities, "الصلاحيّةُ تُكتب نصّاً حرفيّاً — لا متغيّراً لا يُقرأ هنا").not.toContain(null);

        if (!MUTATING.has(h.method)) return;
        const exemption = `${key} ${h.method}`;
        const writes = h.capabilities.filter((c): c is string => c !== null && !isReadOnly(c));
        if (exemption in WRITE_WITH_VIEW) {
          expect(writes, `${exemption} في WRITE_WITH_VIEW وله صلاحيّةُ كتابة — احذفه منها`).toEqual([]);
          return;
        }
        expect(
          writes.length,
          `${h.method} يكتب وحارسُه صلاحيّةُ قراءة (${h.capabilities.join("، ")}) — الكتابة لا تُحرَس بصلاحية قراءة`,
        ).toBeGreaterThan(0);
      });
    }
  }

  it("ولا استثناءَ لمسارٍ لم يعد موجوداً", () => {
    const known = new Set(files.map(posix));
    for (const k of Object.keys(UNGUARDED)) expect(known, `${k} في UNGUARDED وليس في المستودع`).toContain(k);
    for (const k of Object.keys(WRITE_WITH_VIEW)) expect(known).toContain(k.split(" ")[0]);
  });

  it("والقارئ يبلغ الحارسَ عبر دالّةٍ محلّيّة، ويفرّق معالجاً عن آخر", () => {
    const source = `
      import { guard } from "@/services/guard";
      async function handle(request: Request) { const user = await guard("x", "bank:edit"); return user; }
      export async function GET() { await guard("x", "bank:view"); }
      export const POST = (request: Request) => withDeadline(() => handle(request));
      export async function DELETE() { return new Response(null); }
      export async function PATCH() { await guard("x", capabilityFor()); }
    `;
    expect(handlerGuards(source)).toEqual([
      { method: "GET", capabilities: ["bank:view"] },
      { method: "POST", capabilities: ["bank:edit"] },
      { method: "DELETE", capabilities: [] },
      { method: "PATCH", capabilities: [null] },
    ]);
  });
});
