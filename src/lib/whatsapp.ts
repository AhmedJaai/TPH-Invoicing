/**
 * رقمُ الجوّال كما يقبله واتساب (wa.me): «05…» يصير «9665…»، و«+966 5…» يُنظَّف. وما لا يُفهم `null`
 * — لا يُفتح واتساب على رقمٍ خطأ. الأرقامُ العربيّة تُقرأ.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^009665\d{8}$/.test(d)) return d.slice(2);
  /* رقمٌ دوليٌّ غيرُ سعوديّ بمفتاحه */
  if (/^00\d{9,15}$/.test(d)) return d.slice(2);
  if (/^[1-9]\d{9,14}$/.test(d) && !d.startsWith("0")) return d;
  return null;
}

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
