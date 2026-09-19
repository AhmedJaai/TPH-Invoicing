/**
 * عرض المال والفراغ.
 *
 * مفصولان عن `page-shell` عمداً: القشرة تجرّ قائمة المستخدم ومعها فعل
 * خادم، فإذا استوردها مكوّن عميل انكسر البناء. وهذان لا يحتاجان شيئاً
 * من ذلك، فيصلحان للطرفين.
 */

export function Money({ minor, tone }: { minor: number; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "";
  const whole = Math.floor(Math.abs(minor) / 100);
  const frac = String(Math.abs(minor) % 100).padStart(2, "0");
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <span className={`nums ${cls}`} dir="ltr">
      {minor < 0 ? "-" : ""}
      {digits}.{frac}
    </span>
  );
}

/**
 * نصٌّ فيه مبلغ — يُلفّ المبلغُ وحده كي يُخفى مع ما يُخفى.
 *
 * ── لماذا هذا موجود ──
 *
 * زرُّ «أخفِ المبالغ» يعمل على صنف `.nums`، وهو موضوعٌ على كلّ رقمٍ
 * يُرسَم مكوّناً. لكنّ كثيراً من الأرقام تُبنى في الخادم **داخل جملة**:
 * «بقيمة ٣٢٬٦٨٨٫١٥ ريالاً» و«بعد خصم ١٬٤٠٨٫٧٥ دفعتَها». فكانت تبقى
 * ظاهرةً والزرُّ مضغوط — وهو أسوأ من ألّا يكون الزرّ: من يظنّ أنّه أخفى
 * يُري ما لا يريد أن يُري.
 *
 * فبدل تعديل مئةٍ وخمسةٍ وعشرين موضعاً يبني نصّاً، تُقرأ الجملةُ عند
 * عرضها ويُلفّ ما يشبه المبلغ وحده.
 *
 * والنمطُ مضيَّقٌ عمداً: عددٌ بكسرٍ من خانتين (٣٢٬٦٨٨٫١٥)، أو عددٌ
 * بفواصل آلاف (١٢٬٠٠٣). ولا يُلَفّ «٦٠ يوماً» ولا «١٣ دفعة» — تلك
 * أعدادٌ لا مبالغ، وإخفاؤها يُفقد الجملةَ معناها بلا داعٍ.
 */
const MONEY_IN_TEXT = /(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})/g;

export function Prose({ text }: { text: string }) {
  const parts = text.split(MONEY_IN_TEXT);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {/*
        القسمةُ بمجموعةٍ ملتقَطة تجعل الفهرسَ الفرديَّ هو المبلغ دائماً.
        ولا يُسأل التعبيرُ ثانيةً: `test` على تعبيرٍ عامّ يحرّك `lastIndex`
        فيكذب في النداء الذي يليه.
      */}
      {parts.map((part, i) =>
        i % 2 === 1
          ? <span key={i} className="nums">{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
