/**
 * استخراج نصّ كشف الحساب من PDF.
 *
 * والقاعدة التي لا تُخالَف: **لا يُرمى الملفّ كاملاً إلى نموذج لغويّ
 * ويُقال له افهمه.** أكثر كشوف البنوك PDF نصّيّ لا صورة — نصّه مكتوب
 * فيه ومواضعه معلومة. فيُقرأ حسابياً: دقّةً تامّة، وبلا كلفة، وبلا
 * انتظار.
 *
 * والنموذج للمصوَّر وحده — وهو الاستثناء لا الأصل.
 */

export interface PdfWord {
  text: string;
  /** موضع الكلمة على الصفحة — أساس تجميع الصفوف. */
  x: number;
  y: number;
  page: number;
}

export interface PdfExtraction {
  words: PdfWord[];
  pageCount: number;
  /**
   * هل في الملفّ نصٌّ يُقرأ؟
   *
   * `false` تعني مصوَّراً يحتاج قراءةً بصرية — وهي حالٌ تُعلَن ولا
   * تُعالَج بصمت بإرجاع صفوف فارغة.
   */
  hasText: boolean;
}

/** أقلّ عدد كلمات يُعتدّ به نصّاً — ما دونه ملفٌّ مصوَّر أو غلاف. */
export const MIN_WORDS = 40;

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * يقرأ الكلمات ومواضعها.
 *
 * تُحمَّل `unpdf` عند الطلب لا عند بدء التطبيق: هي ثقيلة، وأكثر
 * الكشوف جداول لا PDF، فلا يُدفَع ثمنه إلّا عند الحاجة.
 */
export async function extractPdfWords(buffer: Buffer): Promise<PdfExtraction> {
  /*
    `unpdf` لا `pdfjs-dist` مباشرةً.

    وهي بناءٌ من pdfjs نفسه مهيَّأ للبيئات بلا خادم: العامل مضمَّنٌ فيها
    فلا تستورده استيراداً ديناميكياً. والاستيراد الديناميكيّ هو الذي
    كان يسقط في الإنتاج وحده:

      Setting up fake worker failed: Cannot find module
      '/var/task/.next/server/chunks/pdf.worker.mjs'

    ولم يُصلحه إخراجُ الحزمة من التحزيم ولا حلُّ المسار بـ`require.resolve`
    — لأنّ الملفّ لا يبلغ حزمةَ النشر أصلاً. **والعطب في الحزم لا في
    المسار، فيُعالَج بحزمةٍ لا تحتاج ملفّاً خارجها.**

    والواجهة هي هي: `getTextContent()` يعطي العناصر بمصفوفة `transform`
    نفسها، فما بعد هذه الدالّة لم يتغيّر حرفاً.
  */
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));

  const words: PdfWord[] = [];

  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    for (const item of content.items as TextItem[]) {
      const text = item.str?.trim();
      if (!text) continue;
      words.push({
        text,
        x: item.transform[4],
        y: item.transform[5],
        page,
      });
    }
  }

  return { words, pageCount: doc.numPages, hasText: words.length >= MIN_WORDS };
}

/**
 * يجمع الكلمات في صفوف بمواضعها الرأسية.
 *
 * كلمتان على ارتفاعٍ متقارب في صفٍّ واحد. والتقارب لا يُقاس بالمساواة
 * التامّة: الحروف في السطر الواحد تختلف ارتفاعاتها بكسور النقطة.
 */
export const ROW_TOLERANCE = 3;

export function groupIntoRows(words: readonly PdfWord[]): string[][] {
  const byPage = new Map<number, PdfWord[]>();
  for (const w of words) {
    const list = byPage.get(w.page) ?? [];
    list.push(w);
    byPage.set(w.page, list);
  }

  const rows: string[][] = [];

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const items = byPage.get(page)!;
    const lines = new Map<number, PdfWord[]>();

    for (const w of items) {
      // يُبحث عن سطرٍ قائم يقارب ارتفاعه، وإلّا فُتح سطرٌ جديد
      let key: number | undefined;
      for (const existing of lines.keys()) {
        if (Math.abs(existing - w.y) <= ROW_TOLERANCE) { key = existing; break; }
      }
      const at = key ?? w.y;
      const list = lines.get(at) ?? [];
      list.push(w);
      lines.set(at, list);
    }

    // الأعلى أوّلاً: محور الصفحة في PDF يصعد، والقراءة تنزل
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      /*
        الترتيب داخل السطر من اليمين إلى اليسار.

        الكشوف السعودية عربية، وترتيب PDF بالإحداثيّ لا بالمعنى. فلو
        رُتّب من اليسار لانقلبت الأعمدة.
      */
      const cells = lines
        .get(y)!
        .sort((a, b) => b.x - a.x)
        .map((w) => w.text);
      rows.push(cells);
    }
  }

  return rows;
}
