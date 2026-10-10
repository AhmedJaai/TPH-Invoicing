/**
 * قواعدُ ESLint محلّيّة — حرّاسٌ كانت تُقرأ نصّاً بانتظامٍ في `code-guards.test.ts`
 * و`allocation-sql.test.ts`، فصارت تقرأ شجرةَ الشيفرة.
 *
 * كلٌّ منها عطبٌ وقع فعلاً في هذا المستودع ولا يراه المترجم ولا يرميه التشغيل.
 * والفرق عن الانتظام: يظهر الخطأ في المحرّر عند السطر نفسه قبل الاختبار، ولا
 * يفلت بتغيّر الصياغة (اسمُ متغيّرٍ آخر، سطرٌ مكسور، قوسٌ زائد).
 *
 * بلا حزمةٍ جديدة: ملفٌّ واحد يُحمَّل من `eslint.config.mjs`، واختبارُه
 * `src/lib/lint-rules.test.ts` يثبت أنّ كلّ قاعدةٍ تُمسك الخاطئ وتترك الصواب.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ── ١. الكتابة داخل المعاملة بمقبضها، لا بـ`db` ── */

/**
 * على Vercel في المجمَّع اتّصالٌ واحد تحجزه المعاملة، فينتظر `db` عشر ثوانٍ ثمّ
 * يسقط؛ ومحلّياً يسقط بالمفتاح الأجنبيّ. وقع في `/api/counterparty` خمسةَ أيّام.
 *
 * كلُّ دالّةٍ حجّةٍ لـ`transaction(…)` بأيّ شكل، وكلُّ معرِّفٍ اسمه `db` داخلها
 * ليس اسمَ خاصيّةٍ ولا تعريفاً يحجبه.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noDbInTransaction = {
  meta: {
    type: "problem",
    docs: { description: "داخل المعاملة اكتب بمقبضها لا بـdb" },
    schema: [],
    messages: {
      db: "وصولٌ إلى `db` داخل معاملة — اكتب بمقبضها (`t`/`tx`): على Vercel اتّصالٌ واحد تحجزه المعاملة.",
    },
  },
  create(context) {
    /** دوالّ المعاملات التي نحن داخلها الآن — و`true` إن حجب معاملُها اسمَ `db` */
    const stack = [];
    const isTransactionCall = (node) => {
      const callee = node.callee;
      const name = callee.type === "MemberExpression" && !callee.computed
        ? callee.property.name
        : callee.type === "Identifier" ? callee.name : null;
      return name === "transaction";
    };
    const enter = (fn) => {
      const parent = fn.parent;
      if (parent?.type !== "CallExpression" || !parent.arguments.includes(fn) || !isTransactionCall(parent)) return;
      const shadowed = fn.params.some((p) => {
        const id = p.type === "AssignmentPattern" ? p.left : p;
        return id.type === "Identifier" && id.name === "db";
      });
      stack.push({ fn, shadowed });
    };
    const exit = (fn) => {
      if (stack.length > 0 && stack[stack.length - 1].fn === fn) stack.pop();
    };
    const isGlobalRef = (id) => {
      const p = id.parent;
      if (p.type === "MemberExpression" && p.property === id && !p.computed) return false;
      if ((p.type === "Property" || p.type === "PropertyDefinition" || p.type === "TSPropertySignature")
        && p.key === id && !p.computed && !(p.type === "Property" && p.shorthand)) return false;
      if (p.type === "VariableDeclarator" && p.id === id) return false;
      if (p.type === "TSQualifiedName" || p.type === "TSTypeReference") return false;
      // معاملُ دالّةٍ أو تفكيك: تعريفٌ لا قراءة
      if (/Function/.test(p.type) && p.params?.includes(id)) return false;
      if (p.type === "ArrayPattern" || p.type === "RestElement") return false;
      return true;
    };
    return {
      ArrowFunctionExpression: enter,
      FunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      "FunctionExpression:exit": exit,
      Identifier(node) {
        if (node.name !== "db" || stack.length === 0) return;
        if (stack.every((s) => s.shadowed)) return;
        if (!isGlobalRef(node)) return;
        context.report({ node, messageId: "db" });
      },
    };
  },
};

/* ── ٢. الردّ يُقرأ نصّاً قبل JSON ── */

/**
 * مهلةُ المنصّة (٥٠٤) وحدُّ الحجم (٤١٣) يعودان صفحةً نصّيّة، فينفجر `res.json()`
 * بـ«Unexpected token». والقراءة في `lib/http-client`.
 *
 * يُمسك `await <ردّ>.json()` أيّاً كان اسمُ المتغيّر — إلّا `request`/`req`
 * (جسمُ الطلب في الخادم، وله قاعدتُه).
 */
/** @type {import("eslint").Rule.RuleModule} */
const noBareResponseJson = {
  meta: {
    type: "problem",
    docs: { description: "الشاشة تقرأ الردّ نصّاً قبل JSON" },
    schema: [],
    messages: {
      bare: "`await {{name}}.json()` ينفجر على ردٍّ نصّيّ (٥٠٤/٤١٣) — اقرأ عبر `@/lib/http-client`.",
    },
  },
  create(context) {
    return {
      "AwaitExpression > CallExpression"(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "json") return;
        if (node.arguments.length > 0) return;
        const object = callee.object;
        if (object.type !== "Identifier" || /^(request|req)$/i.test(object.name)) return;
        context.report({ node, messageId: "bare", data: { name: object.name } });
      },
    };
  },
};

/* ── ٣. نصُّ الخطأ الخامّ لا يُعاد إلى المتصفّح ── */

/**
 * `{ error: (e as Error).message }` يعرض خطأ Drizzle بنصّ استعلامه وقيمه، وخطأ `pg`
 * باسم مضيفه. والخاتمة `failWith(e, route)` / `respondTo(e)` في `services/guard.ts`.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noRawErrorBody = {
  meta: {
    type: "problem",
    docs: { description: "المسار لا يعيد نصَّ الخطأ الخامّ" },
    schema: [],
    messages: {
      raw: "نصُّ الخطأ الخامّ يخرج إلى المتصفّح (استعلامٌ وقيمٌ واسمُ مضيف) — اختم بـ`respondTo(e)` أو `failWith(e, route)`.",
    },
  },
  create(context) {
    const unwrap = (n) => {
      let x = n;
      while (x && (x.type === "TSAsExpression" || x.type === "TSNonNullExpression" || x.type === "TSTypeAssertion")) x = x.expression;
      return x;
    };
    return {
      Property(node) {
        if (node.computed) return;
        const key = node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (key !== "error") return;
        const value = node.value;
        if (value.type !== "MemberExpression" || value.computed || value.property.name !== "message") return;
        // الممنوعُ ما صُبّ بـ`as Error`: خطأٌ مجهولُ المصدر. ورسالةُ خطئنا المنمَّط تُكتب صريحة.
        if (value.object.type !== "TSAsExpression" && value.object.type !== "TSTypeAssertion") return;
        if (unwrap(value.object)?.type !== "Identifier") return;
        context.report({ node, messageId: "raw" });
      },
    };
  },
};

/* ── ٤. جسمُ الطلب يُفحَص وقتَ التشغيل ── */

/**
 * `(await request.json()) as Body` وعدٌ للمترجم لا فحصٌ للطلب: رقمٌ حيث يُنتظر نصّ
 * يصير ٥٠٠ بلا جملة. فالمسارات تقرأ بـ`readJson(request, Schema)`.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noCastRequestBody = {
  meta: {
    type: "problem",
    docs: { description: "جسمُ الطلب لا يُصبّ بـas" },
    schema: [],
    messages: {
      cast: "جسمُ الطلب صُبَّ بـ`as` بلا فحص — اقرأه بـ`readJson(request, Schema)` (`lib/request-body.ts`).",
    },
  },
  create(context) {
    /** أفي التعبير نداءُ `request.json()`؟ — بلا نزولٍ في دوالّ داخليّة غير `catch` */
    const readsRequestJson = (n, depth = 0) => {
      if (!n || typeof n.type !== "string" || depth > 8) return false;
      if (n.type === "CallExpression") {
        const c = n.callee;
        if (c.type === "MemberExpression" && !c.computed && c.property.name === "json"
          && c.object.type === "Identifier" && /^(request|req)$/.test(c.object.name)) return true;
        return readsRequestJson(c, depth + 1);
      }
      if (n.type === "MemberExpression") return readsRequestJson(n.object, depth + 1);
      if (n.type === "AwaitExpression") return readsRequestJson(n.argument, depth + 1);
      if (n.type === "LogicalExpression") return readsRequestJson(n.left, depth + 1) || readsRequestJson(n.right, depth + 1);
      if (n.type === "TSAsExpression" || n.type === "TSNonNullExpression") return readsRequestJson(n.expression, depth + 1);
      return false;
    };
    return {
      TSAsExpression(node) {
        // `as const` و`as unknown` ليسا وعداً بشكلٍ
        const t = node.typeAnnotation;
        if (t.type === "TSUnknownKeyword") return;
        if (t.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "const") return;
        if (!readsRequestJson(node.expression)) return;
        context.report({ node, messageId: "cast" });
      },
    };
  },
};

/* ── ٥. الاستعلامُ الفرعيّ المرتبط يُكتب بالمرجع لا بالعمود ── */

/**
 * `${invoices.id}` داخل قالب `sql` خامّ يُصيّر العمود **مجرّداً** فينفصل عن صفّه،
 * فيصمت الاستعلامُ الفرعيّ ويُرجع **صفراً — لا خطأً**. وقع في `findPaymentTwin`
 * وفي `/api/match-confirm`: كلُّ فاتورةٍ مسدَّدة بدت مفتوحة، وردّ السدادَ المزدوج
 * مؤثِّرُ ٠٠٧ في القاعدة لا الشيفرة. والصواب `${invoices}.id`.
 *
 * ويُضيَّق عمداً على جداول المخطّط وعلى استعلامٍ فرعيّ يُفتح بقوس وبلغ `where`:
 * `${table.column}` في تجميعٍ على الاستعلام الرئيس صحيحٌ وشائع.
 */
function schemaTables() {
  try {
    const schema = readFileSync(path.join(ROOT, "src", "db", "schema.ts"), "utf8");
    return new Set([...schema.matchAll(/export const (\w+) = pgTable\(/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

const SUBQUERY_REACHING_WHERE = /\(\s*select[\s\S]{0,200}?where[^`)]{0,120}?$/i;

/** @type {import("eslint").Rule.RuleModule} */
const noColumnInCorrelatedSubquery = {
  meta: {
    type: "problem",
    docs: { description: "الاستعلام الفرعيّ المرتبط بالمرجع لا بالعمود" },
    schema: [{ type: "object", properties: { tables: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
    messages: {
      column: "`${{{table}}.{{column}}}` في استعلامٍ فرعيّ يُرجع صفراً صامتاً — اكتبه `${{{table}}}.{{snake}}` (مرجعُ الجدول ثمّ اسمُ العمود حرفيّاً).",
    },
  },
  create(context) {
    const configured = context.options[0]?.tables;
    const tables = configured ? new Set(configured) : schemaTables();
    const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return {
      TaggedTemplateExpression(node) {
        const tag = node.tag;
        const tagName = tag.type === "Identifier" ? tag.name
          : tag.type === "MemberExpression" && tag.object.type === "Identifier" ? tag.object.name : null;
        if (tagName !== "sql") return;
        const { quasis, expressions } = node.quasi;
        /* النصُّ قبل كلّ تعبير — والتعبيراتُ السابقة تُمثَّل بنائبٍ لا يحمل قوساً ولا `where` */
        let before = "";
        expressions.forEach((expr, i) => {
          before += quasis[i].value.raw;
          if (expr.type === "MemberExpression" && !expr.computed
            && expr.object.type === "Identifier" && tables.has(expr.object.name)
            && SUBQUERY_REACHING_WHERE.test(before)) {
            context.report({
              node: expr,
              messageId: "column",
              data: { table: expr.object.name, column: expr.property.name, snake: snake(expr.property.name) },
            });
          }
          before += "$x";
        });
      },
    };
  },
};

/* ── ٦. تسميةُ ملفّات الدرايف في موضعٍ واحد ── */

/**
 * القيدُ الأوّل: لا تسميةَ بلا أثرٍ في السجلّ بالاسمين. فلا يُستدعى `renameFile`
 * إلّا من `drive-rename.service.ts` — والملفّان المأذونان يُستثنيان في الإعداد.
 */
/** @type {import("eslint").Rule.RuleModule} */
const renameFileOnlyInService = {
  meta: {
    type: "problem",
    docs: { description: "renameFile لا يُستدعى إلّا من خدمة التسمية" },
    schema: [],
    messages: {
      rename: "`renameFile` لا يُستدعى إلّا من `src/services/drive-rename.service.ts` — هي التي تكتب الاسمين في سجلّ التدقيق.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const c = node.callee;
        const name = c.type === "Identifier" ? c.name
          : c.type === "MemberExpression" && !c.computed ? c.property.name : null;
        if (name === "renameFile") context.report({ node, messageId: "rename" });
      },
    };
  },
};

/* ── ٧. المالُ المعروض يمرّ بمنسّقٍ واحد ── */

/**
 * كان المبلغ نفسه يُكتب «1500.00» في رسالة و«1,500.00» في أخرى. فما يُعرض لإنسان
 * يمرّ بـ`formatRiyalsDisplay`؛ وما يُقرأ آلةً (ملفّ البنك، نصُّ النموذج) مستثنًى
 * في الإعداد.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noInlineRiyalsFormat = {
  meta: {
    type: "problem",
    docs: { description: "لا قسمةَ مالٍ مضمَّنة في نصٍّ يُعرض" },
    schema: [],
    messages: {
      inline: "`(x / 100).toFixed(2)` تنسيقُ مالٍ مضمَّن — استعمل `formatRiyalsDisplay` (`lib/money.ts`).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== "MemberExpression" || c.computed || c.property.name !== "toFixed") return;
        if (node.arguments.length !== 1 || node.arguments[0].type !== "Literal" || node.arguments[0].value !== 2) return;
        const o = c.object;
        if (o.type !== "BinaryExpression" || o.operator !== "/") return;
        const r = o.right;
        const isHundred = (r.type === "Literal" && r.value === 100)
          || (r.type === "Identifier" && r.name === "HALALAS_PER_RIYAL");
        if (isHundred) context.report({ node, messageId: "inline" });
      },
    };
  },
};

/** @type {import("eslint").ESLint.Plugin & { rules: Record<string, import("eslint").Rule.RuleModule> }} */
const plugin = {
  meta: { name: "eslint-plugin-tph", version: "1.0.0" },
  rules: {
    "no-db-in-transaction": noDbInTransaction,
    "no-bare-response-json": noBareResponseJson,
    "no-raw-error-body": noRawErrorBody,
    "no-cast-request-body": noCastRequestBody,
    "no-column-in-correlated-subquery": noColumnInCorrelatedSubquery,
    "rename-file-only-in-service": renameFileOnlyInService,
    "no-inline-riyals-format": noInlineRiyalsFormat,
  },
};

export default plugin;
