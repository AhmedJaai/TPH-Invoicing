import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * عنصرٌ في مصفوفةِ `<T a={[…]} />` يحمل مفتاحاً.
 *
 * `a` مصفوفةُ عناصر تعبر من مكوّن الخادم إلى `T` (مكوّنُ متصفّح)، فيفحص React
 * مفاتيحَها: عنصرٌ بلا `key` — وأكثرُه `<>…</>` أو `شرط && <…>` — كان يطبع
 * «Each child in a list should have a unique "key" prop» في كلّ صفحاتِ المالية
 * و`/performance` (١٧ صفحةً في الزاحف)، فتغرق الطرفيّةُ ويُخفي التحذيرُ المتكرّرُ
 * خطأً حقيقيّاً بجانبه. والجزءُ النصّيّ (سلسلةٌ أو رقم) لا يحتاج مفتاحاً.
 */
const ROOT = "src";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function hasKey(attrs: ts.JsxAttributes): boolean {
  return attrs.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "key");
}

/** العنصرُ الذي يُرسَم من هذا الطرف — بعد `&&` و`? :` والأقواس. */
function unkeyed(node: ts.Expression): ts.Node[] {
  if (ts.isParenthesizedExpression(node)) return unkeyed(node.expression);
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    /* `شرط && <…>`: الشرطُ لا يُرسَم، والطرفُ الأيمن يُرسَم */
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return unkeyed(node.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return [...unkeyed(node.left), ...unkeyed(node.right)];
  }
  if (ts.isConditionalExpression(node)) return [...unkeyed(node.whenTrue), ...unkeyed(node.whenFalse)];
  if (ts.isJsxFragment(node)) return [node];
  if (ts.isJsxSelfClosingElement(node)) return hasKey(node.attributes) ? [] : [node];
  if (ts.isJsxElement(node)) return hasKey(node.openingElement.attributes) ? [] : [node];
  return [];
}

export function findUnkeyedSlots(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === "T") {
      for (const p of node.attributes.properties) {
        if (!ts.isJsxAttribute(p) || p.name.getText() !== "a" || !p.initializer || !ts.isJsxExpression(p.initializer)) continue;
        const arr = p.initializer.expression;
        if (!arr || !ts.isArrayLiteralExpression(arr)) continue;
        for (const el of arr.elements) {
          for (const bad of unkeyed(el)) {
            const { line } = sf.getLineAndCharacterOfPosition(bad.getStart());
            out.push(`${file}:${line + 1} ${bad.getText().slice(0, 60).replace(/\s+/g, " ")}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("مصفوفةُ `<T a>` بمفاتيح", () => {
  it("يمسك الجزءَ بلا مفتاح ويترك ذا المفتاح والنصّ", () => {
    const src = `const x = <T s="{0}{1}{2}{3}" a={["نصّ", <b key="1">x</b>, ok && <></>, <i>y</i>]} />;`;
    const found = findUnkeyedSlots("x.tsx", src);
    expect(found).toHaveLength(2);
  });

  it("لا عنصرَ بلا مفتاح في أيّ `<T a>`", () => {
    const found = files(ROOT).flatMap((f) => findUnkeyedSlots(f, readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });
});
