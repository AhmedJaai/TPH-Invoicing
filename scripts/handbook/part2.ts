/** الدليل — الجزء الثاني: معمارية الشيفرة، وكلُّ صفحة، وكلُّ زرّ، وكلُّ مسار. */
import { figure, h2, h3, h4, note, p, pageBreak, table, ul } from "./render";
import * as D from "./diagrams";
import type * as C from "./collect";
import { PAGE_GUIDE, BUTTONS, KEY_MODULES, WORKFLOWS } from "./content";

export function part2(data: {
  files: C.FileInfo[];
  api: C.ApiInfo[];
  pages: C.PageInfo[];
}): string {
  const { files, api, pages } = data;
  const real = pages.filter((x) => !x.redirectTo);
  const redirects = pages.filter((x) => x.redirectTo);

  const group = (prefix: string) =>
    files.filter((f) => f.file.startsWith(prefix)).sort((a, b) => b.lines - a.lines);

  return `
${pageBreak}
${h2("code", "٥", "معمارية الشيفرة")}

${h3("الطبقات ومن يستورد من")}

${table(["المجلّد", "ما فيه", "يستورد من", "ملفّات"], [
  ["`src/app/`", "الصفحات ومسارات API", "components · services · lib · db", group("src/app").length],
  ["`src/components/`", "عناصرُ العرض والتفاعل", "lib · db (للأنواع)", group("src/components").length],
  ["`src/services/`", "منطقٌ يكتب في القاعدة، وكلُّه في معاملة", "lib · db", group("src/services").length],
  ["`src/lib/`", "**دوالُّ خالصة** — الحساب الماليّ كلُّه هنا", "لا شيء من app أو components", group("src/lib").length],
  ["`src/db/`", "المخطّط والاتّصال", "—", group("src/db").length],
], "compact")}

${note("**القاعدةُ الحاكمة**: ما في `lib/` لا يعرف شيئاً عن الويب. فيُختبَر بلا قاعدةٍ ولا متصفّح، وهو ما يجعل ١٩٠٠+ اختبارٍ تمرّ في أقلّ من ثانيتين. وثمنُ ذلك مذكورٌ في §١٠: الاختباراتُ النقيّة لا تُثبت أنّ النظام **موصول**.")}

${h3("حُرّاسٌ نصّيّة — ما لا يراه المترجم")}

${p("ثلاثةُ أخطاءٍ في هذا المستودع لم يرها TypeScript ولا رماها التشغيل، وكلُّها كلّفت. فصار لكلٍّ حارسٌ يقرأ الملفّ **نصّاً**:")}

${table(["الحارس", "ما يمنع", "العطب الذي أنشأه"], [
  ["`code-guards.test.ts`", "`db.` داخل معاملة", "على Vercel في المجمَّع اتّصالٌ واحد تحجزه المعاملة، فينتظر `db` عشر ثوانٍ ثمّ يسقط. فلم يُحفَظ تعريفُ جهةٍ من الواجهة خمسة أيّام، ولم يكشفه اختبار."],
  ["`code-guards.test.ts`", "`renameFile` خارج `/api/drive-rename`", "العمليّةُ الكتابيّةُ الوحيدة على الدرايف — تبقى في موضعٍ واحد يُراجَع."],
  ["`code-guards.test.ts`", "`res.json()` خامّ في الشاشات", "المزوّد يردّ صفحةً نصّية عند المهلة، فتنفجر الشاشة بـ«Unexpected token 'A'» — رسالةٌ عن المحلّل لا عن العطب."],
  ["`code-guards.test.ts`", "قسمةُ مالٍ مضمَّنة `/ 100).toFixed(2)`", "كان المبلغ نفسه «1500.00» في رسالة و«1,500.00» في أخرى: تسعُ دوالّ محلّية وخمسٌ وعشرون قسمة."],
  ["`allocation-sql.test.ts`", "`${table.id}` في استعلامٍ فرعيّ مرتبط", "يُصيِّر العمودَ مجرّداً فيصمت ويُرجع صفراً **لا خطأً**. فبدت كلُّ فاتورةٍ مسدَّدة مفتوحةً، ورُدَّ السدادُ المزدوج من القاعدة لا من الشيفرة. والصواب `${table}.id`."],
  ["`vocabulary.test.ts`", "أسماءٌ مهجورة لمفاهيم لها اسمٌ واحد", "«المستحقّ للمورّدين» و«عليك للمورّدين» و«المستحقّ عليك» لمفهومٍ واحد في ثلاث شاشات."],
], "compact")}

${h3("المكتبات الأساسية")}

${p("ما يلي ليس جردَ ملفّات؛ هو ما **يجب أن يُعرَف قبل كتابة سطر**. وكلُّ وصفٍ مأخوذٌ من تعليق رأس الملفّ نفسِه.")}

${table(["الملفّ", "مسؤوليّته"], KEY_MODULES.map((m) => [`\`${m.file}\``, m.what]), "compact")}

${pageBreak}
${h2("nav", "٦", "التنقّل والمعمارية المعلوماتية")}

${figure(D.navTree, "خمسُ مساحات. والمساحةُ سؤالٌ يفتحه صاحب المقهى، لا وحدةٌ في البرنامج.")}

${h3("لماذا خمسٌ لا ستّ، ولماذا شريطٌ جانبيّ")}

${p("كان التنقّل ستَّ مساحاتٍ وواحداً وعشرين وجهةً في شريطٍ علويٍّ من صفّين، يأكل نحو مئةٍ وعشرين بكسلاً رأسيّاً من كلّ صفحة ويقفز ظهوراً واختفاءً بحسب المساحة. وفيه ما ليس وجهةً أصلاً: «الإعدادات» تُضبط مرّةً في العمر وتحتلّ سُدسَ الشريط.")}

${table(["", "قبل", "بعد"], [
  ["مساحات التنقّل", "٦", "**٥**"],
  ["وجهات التنقّل كلُّها", "٢١", "**١٤**"],
  ["أكثرُ ما يُرى في شاشة", "١٤", "**١٠**"],
  ["صفحاتٌ فيها محتوى", "٢٣", `**${real.length}**`],
  ["تحويلاتٌ تحفظ الروابط", "٢", `**${redirects.length}**`],
], "compact")}

${h3("الصفحاتُ المحذوفة — وأين ذهبت قدراتُها")}

${table(["المسار القديم", "يحوّل إلى", "لِمَ حُذف"], redirects.map((r) => [
  `\`${r.route}\``,
  `\`${r.redirectTo}\``,
  r.doc,
]), "compact")}

${pageBreak}
${h2("pages", "٧", "كلُّ صفحة: ماذا تجيب، وكلُّ زرّ فيها")}

${real.map((pg) => {
  const guide = PAGE_GUIDE[pg.route];
  const btns = BUTTONS.filter((b) => b.page === pg.route);
  return `
${h3(`${pg.title || pg.route} · \`${pg.route}\``, `page-${pg.route.replace(/[^a-z]/gi, "-")}`)}
${pg.intro ? p(`**ما تقوله للمستخدم:** ${pg.intro}`) : ""}
${guide?.answers ? p(`**السؤال الذي تجيبه:** ${guide.answers}`) : ""}
${guide?.why ? p(guide.why) : (pg.doc ? p(pg.doc) : "")}
${guide?.shows ? `<p><strong>ماذا تعرض:</strong></p>${ul(guide.shows)}` : ""}
${btns.length > 0
  ? `<p><strong>الأزرار والأفعال:</strong></p>${table(["الزرّ", "ماذا يفعل", "ما يستدعيه", "الصلاحية"], btns.map((b) => [
      `«${b.label}»`, b.does, b.calls ? `\`${b.calls}\`` : "تنقّلٌ فقط", b.cap ? `\`${b.cap}\`` : "—",
    ]), "compact")}`
  : ""}
${pg.components.length > 0 ? p(`**مكوّناتها:** ${pg.components.map((c) => `\`${c}\``).join(" · ")}`) : ""}
${pg.deps.length > 0 ? p(`**تقرأ من:** ${pg.deps.slice(0, 10).map((c) => `\`${c}\``).join(" · ")}${pg.deps.length > 10 ? " …" : ""}`) : ""}
`;
}).join("")}

${pageBreak}
${h2("api", "٨", "مسارات الواجهة البرمجية")}

${p("تسعةٌ وعشرون مساراً. وكلُّ ما يكتب محروسٌ بصلاحية، وكلُّ ما يكتب مالاً يُسجَّل في سجلّ التدقيق.")}

${api.map((a) => `
${h4(`\`${a.route}\` — ${a.methods.join(" · ")}`)}
${a.doc ? p(a.doc) : ""}
${table(["الصلاحية", "المدخل", "التشغيل", "المهلة"], [[
  a.capability ? `\`${a.capability}\`` : "—",
  a.fields.length ? a.fields.map((f) => `\`${f}\``).join(" · ") : "—",
  `\`${a.runtime}\``,
  a.maxDur === "—" ? "—" : `${a.maxDur} ثانية`,
]], "compact tight")}
`).join("")}

${pageBreak}
${h2("flows", "٩", "مسارات العمل")}

${figure(D.invoiceFlow, "دورةُ حياة الفاتورة — من الملفّ إلى السداد.")}

${WORKFLOWS.map((w) => `
${h3(w.title)}
${p(w.intro)}
${table(["#", "الخطوة", "أين تقع", "ما يُكتب"], w.steps.map((s, i) => [i + 1, s.step, `\`${s.where}\``, s.writes]), "compact")}
${w.rules.length ? `<p><strong>القواعد التي تحكمه:</strong></p>${ul(w.rules)}` : ""}
`).join("")}

${figure(D.truthMap, "مصدرُ الحقيقة لكلّ رقم. وكان لكلّ شاشةٍ حسابُها، فاختلفت الأعدادُ تحت العنوان الواحد.")}
`;
}
