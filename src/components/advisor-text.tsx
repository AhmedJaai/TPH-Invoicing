import { Fragment } from "react";
import { groupThousands, splitNumbers } from "@/lib/advisor/numbers";

/** حقيقةٌ مرجعيّة عامّة (`monthsOverviewFacts`) — تُوسَم «مرجعاً» لا «من دفاترك». */
const REFERENCE_PREFIX = "مرجع عامّ لا من الدفاتر";

/**
 * جوابُ المستشار مقروءاً: عناوينُه ونقاطُه وغامقُه — وكلُّ رقمٍ موسومٌ بأصله.
 *
 * ما طابق حقيقةً من الدفاتر يُرى بخطٍّ تحته متّصل ويقول اسمَها عند الوقوف عليه؛ وما لم
 * يطابق بخطٍّ منقّط «عامّ أو تقدير». فلا يبني صاحبُ المقهى على رقمٍ لا يعرف أصله.
 * وليس محرّرَ Markdown: ما يكتبه النموذجُ نصٌّ، ولا يُحقَن HTML.
 */
function Inline({ text, verified }: { text: string; verified: Record<string, string> }) {
  /* الغامقُ أوّلاً، ثمّ الأرقامُ داخل كلّ قطعة */
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const bold = part.startsWith("**") && part.endsWith("**");
        const inner = bold ? part.slice(2, -2) : part;
        const pieces = splitNumbers(inner).map((p, j) => {
          if (p.kind === "text") return <Fragment key={j}>{p.text}</Fragment>;
          /* المفتاحُ بنوعه («num:4546»)؛ وما حُفظ قبله بقيمته وحدها يُقرأ كذلك */
          const label = p.key ? verified[p.key] ?? verified[p.key.slice(p.key.indexOf(":") + 1)] : undefined;
          if (label && label.startsWith(REFERENCE_PREFIX)) {
            const what = label.slice(REFERENCE_PREFIX.length).replace(/^\s*—\s*/, "");
            return <span key={j} className="nums underline decoration-accent decoration-dashed decoration-2 underline-offset-4" data-tip={`مرجع عام للصناعة، لا من دفاترك: ${what}`} title={`مرجع عام للصناعة، لا من دفاترك: ${what}`}>{groupThousands(p.text)}</span>;
          }
          if (label) {
            return <span key={j} className="nums font-bold text-ink underline decoration-ok decoration-2 underline-offset-4" data-tip={`من دفاترك: ${label}`} title={`من دفاترك: ${label}`}>{groupThousands(p.text)}</span>;
          }
          if (p.key) {
            return <span key={j} className="nums underline decoration-line-input decoration-dotted decoration-2 underline-offset-4" data-tip="رقم عام أو تقدير، لم يُحسب من دفاترك" title="رقم عام أو تقدير، لم يُحسب من دفاترك">{groupThousands(p.text)}</span>;
          }
          return <span key={j} className="nums">{groupThousands(p.text)}</span>;
        });
        return bold ? <strong key={i} className="font-bold text-ink">{pieces}</strong> : <Fragment key={i}>{pieces}</Fragment>;
      })}
    </>
  );
}

type Block =
  | { kind: "h"; level: 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

export function parseBlocks(content: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: "p", text: para.join(" ") }); para = []; } };
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: "h", level: h[1].length <= 2 ? 2 : 3, text: h[2].replace(/\*\*/g, "") }); continue; }
    const ul = /^[-•*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const text = (ul ?? ol)![1];
      const prev = out.at(-1);
      if (prev && prev.kind === kind) prev.items.push(text);
      else out.push({ kind, items: [text] });
      continue;
    }
    /* جدولٌ كتبه رغم المنع: يُقرأ سطوراً لا رموزاً */
    if (/^\|.*\|$/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      para.push(line.split("|").map((c) => c.trim()).filter(Boolean).join(" · "));
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

export function AdvisorText({ content, verified }: { content: string; verified: Record<string, string> }) {
  const blocks = parseBlocks(content);
  return (
    <div className="space-y-3 text-[15px] leading-8 text-ink-soft">
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return b.level === 2
            ? <h3 key={i} className="pt-2 text-base font-bold text-ink">{b.text}</h3>
            : <h4 key={i} className="pt-1 text-sm font-bold text-ink">{b.text}</h4>;
        }
        if (b.kind === "p") return <p key={i}><Inline text={b.text} verified={verified} /></p>;
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1.5 ps-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-muted`}>
            {b.items.map((item, j) => <li key={j}><Inline text={item} verified={verified} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
