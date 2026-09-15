/**
 * الصادرات الميّتة — يفشل عند صادرٍ في `src` لا يستورده شيء.
 *
 *   npm run lint:dead
 *
 * وجدت مراجعة سبتمبر سبعةً وعشرين صادراً لا يستورده ملفّ، منها بقيّةُ
 * «الاسم البديل يُكتب مرّتين»: `learnAlias` بحدّه الأدنى ميّتة، ومسارٌ
 * يُدرج الاسم بيده بلا حدّ. سطحٌ يُقرأ ولا يعمل، ومن يقرؤه يظنّه موصولاً.
 * و«ما كان ميّتاً بلا شاشةٍ ولا مستدعٍ حُذف بدل أن يُسرَد» — فلا يعود.
 *
 * ميّتٌ = صادرٌ لا يستورده ملفٌّ في `src` أو `scripts` أو اختبار، ولا يُستعمل
 * في ملفّه نفسه. والمستثنى مداخلُ Next (`page`/`route`/`layout`… بأسمائها
 * المعروفة) و`proxy.ts` و`instrumentation.ts`. ولا نفاذ لمترجمٍ كامل:
 * القراءة نحويّة، والاستيراد يُحلّ بـ`@/` والمسار النسبيّ.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|mts)$/.test(n) && !n.endsWith(".d.ts")) out.push(f);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return path.normalize(c);
  }
  return null;
}

const NEXT_FILE = /(^|\/)(page|layout|route|loading|error|not-found|global-error|template|default|manifest|robots|sitemap|icon|apple-icon|opengraph-image)\.(ts|tsx)$/;
const NEXT_EXPORTS = new Set([
  "default", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "metadata", "generateMetadata",
  "dynamic", "revalidate", "runtime", "maxDuration", "viewport", "generateStaticParams", "dynamicParams",
  "fetchCache", "preferredRegion",
]);

export function isEntry(file: string, name: string): boolean {
  const f = file.split(path.sep).join("/");
  return (
    (f.startsWith("src/app/") && NEXT_FILE.test(f) && NEXT_EXPORTS.has(name)) ||
    (f === "src/proxy.ts" && ["proxy", "config", "default"].includes(name)) ||
    (f === "src/instrumentation.ts" && ["register", "onRequestError"].includes(name))
  );
}

function main() {
  const all = [...walk("src"), ...walk("scripts"), ...["next.config.ts", "vitest.config.mts", "vitest.db.config.mts", "drizzle.config.ts"].filter(existsSync)];
  const exported = new Map<string, Map<string, { line: number; localUses: number }>>();
  const used = new Map<string, Set<string>>(); // target -> names ("*" = كلّ شيء)

  const markUsed = (target: string, name: string) => {
    if (!used.has(target)) used.set(target, new Set());
    used.get(target)!.add(name);
  };

  for (const file of all) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const ex = new Map<string, { line: number; localUses: number }>();
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const namespaces = new Map<string, string>();
    const has = (n: ts.Node, flag: ts.ModifierFlags) => (ts.getCombinedModifierFlags(n as ts.Declaration) & flag) !== 0;

    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const t = resolve(file, st.moduleSpecifier.text);
        const cl = st.importClause;
        if (!t || !cl) continue;
        if (cl.name) markUsed(t, "default");
        if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) namespaces.set(cl.namedBindings.name.text, t);
        else if (cl.namedBindings) for (const el of cl.namedBindings.elements) markUsed(t, (el.propertyName ?? el.name).text);
      } else if (ts.isExportDeclaration(st)) {
        const t = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolve(file, st.moduleSpecifier.text) : null;
        if (st.moduleSpecifier && !t) continue;
        if (t && !st.exportClause) { markUsed(t, "*"); continue; }
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            if (t) markUsed(t, (el.propertyName ?? el.name).text);
            ex.set(el.name.text, { line: line(st), localUses: 0 });
          }
        }
      } else if (has(st, ts.ModifierFlags.Export)) {
        if (has(st, ts.ModifierFlags.Default)) ex.set("default", { line: line(st), localUses: 0 });
        else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) ex.set(d.name.text, { line: line(st), localUses: 0 });
        } else {
          const name = (st as ts.DeclarationStatement).name;
          if (name && ts.isIdentifier(name)) ex.set(name.text, { line: line(st), localUses: 0 });
        }
      } else if (ts.isExportAssignment(st)) ex.set("default", { line: line(st), localUses: 0 });
    }

    const counts = new Map<string, number>();
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) counts.set(n.text, (counts.get(n.text) ?? 0) + 1);
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text)) {
        markUsed(namespaces.get(n.expression.text)!, n.name.text);
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a = n.arguments[0];
        const t = a && ts.isStringLiteral(a) ? resolve(file, a.text) : null;
        if (t) markUsed(t, "*");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const [k, v] of ex) v.localUses = counts.get(k) ?? 0;
    exported.set(file, ex);
  }

  const dead: string[] = [];
  for (const [file, ex] of exported) {
    if (!file.startsWith(`src${path.sep}`) || /\.test\.tsx?$/.test(file)) continue;
    const u = used.get(file) ?? new Set<string>();
    for (const [name, info] of ex) {
      if (isEntry(file, name) || u.has(name) || u.has("*")) continue;
      // صادرٌ يُستعمل في ملفّه: عيبُ تصديرٍ زائد لا شيفرةٌ ميّتة
      if (info.localUses > 1) continue;
      dead.push(`${file}:${info.line} ${name}`);
    }
  }

  if (dead.length > 0) {
    console.error(`✕ ${dead.length} صادراً لا يستورده شيء — احذفه، أو أوصِله بمستدعٍ:`);
    for (const d of dead.sort()) console.error(`    ${d}`);
    process.exit(1);
  }
  console.log(`✓ لا صادرَ ميّتاً في src (${all.length} ملفّاً مقروءاً)`);
}

main();
