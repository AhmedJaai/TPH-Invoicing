/** أدواتُ الرسم: هروبٌ آمن، وجداولُ تُبنى من بيانات لا من نصّ. */

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** `نصّ` و**نصّ** يُصيَّران — فالتعليقات في هذا المستودع مكتوبةٌ بهما. */
export const md = (s: string): string =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

export const h2 = (id: string, n: string, t: string) =>
  `<h2 id="${id}"><span class="num">${n}</span>${esc(t)}</h2>`;

export const h3 = (t: string, id?: string) =>
  `<h3${id ? ` id="${id}"` : ""}>${esc(t)}</h3>`;

export const h4 = (t: string) => `<h4>${esc(t)}</h4>`;

export const p = (t: string) => `<p>${md(t)}</p>`;

export const note = (t: string) => `<div class="note">${md(t)}</div>`;

export const warn = (t: string) => `<div class="warn">${md(t)}</div>`;

export const ul = (items: string[]) =>
  `<ul>${items.map((i) => `<li>${md(i)}</li>`).join("")}</ul>`;

export function table(headers: string[], rows: (string | number)[][], cls = ""): string {
  if (rows.length === 0) return `<p class="muted">لا صفوف.</p>`;
  return `<table class="${cls}">
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${md(String(c))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

export const code = (s: string) => `<pre class="code">${esc(s)}</pre>`;

export const figure = (svg: string, caption: string) =>
  `<figure>${svg}<figcaption>${md(caption)}</figcaption></figure>`;

/** فاصلُ صفحةٍ في الطباعة — الأقسامُ الكبيرة تبدأ من رأس صفحة. */
export const pageBreak = `<div class="page-break"></div>`;
