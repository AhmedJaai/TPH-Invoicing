/**
 * كيف يبلغ المستندُ النموذجَ؟
 *
 * ثلاثة أجوبة، والقرار يُتَّخذ هنا مرّةً واحدة فلا يتكرّر في كل مستدعٍ:
 *
 *   TEXT   — الـPDF نصّيّ: نصّه مكتوبٌ فيه بمواضعه. يُقرأ حسابياً
 *            ويُرسَل نصّاً إلى النموذج الرخيص. لا رؤية، ولا كلفة صورة،
 *            ولا خطأ قراءةٍ بصريّ أصلاً.
 *   IMAGE  — مصوَّر: تُنتزَع صورته وتُرسَل إلى نموذج الرؤية.
 *   UNREADABLE — لا نصّ ولا صورةَ تُنتزَع. يُعلَن ولا يُخمَّن.
 *
 * ── ولماذا النصّ أوّلاً ──
 *
 * ليس توفيراً وحده. **الرقم المكتوب في الـPDF مقروءٌ يقيناً، والرقم
 * المرسوم في صورةٍ مقروءٌ ظنّاً.** فحين يكون النصّ موجوداً تكون قراءتُه
 * أدقّ من أيّ نموذج رؤية مهما جوّد — لأنّها ليست قراءة، هي نقل.
 *
 * وهذه القاعدة مكتوبة في `bank/parsers/pdf-text.ts` منذ بُني قارئ
 * كشوف البنك: «لا يُرمى الملفّ كاملاً إلى نموذج لغويّ ويُقال له افهمه».
 * وهي هنا نفسها، مطبَّقةً على الفواتير.
 */
import { extractPdfWords, ROW_TOLERANCE, type PdfWord } from "@/lib/bank/parsers/pdf-text";
import { extractEmbeddedJpegs, type EmbeddedImage } from "./pdf-images";
import { isDeepseekImageType } from "./models";

export const PDF_TYPE = "application/pdf";

/**
 * أقلّ عدد كلماتٍ يُعدّ الملفّ بها نصّياً.
 *
 * أعلى من عتبة كشوف البنك (٤٠) عمداً: الفاتورة الممسوحة قد تحمل نصّاً
 * قليلاً في ترويسةٍ رقميّة — رقم ملفٍّ أو ختم زمنيّ — بينما جسدُها كلّه
 * صورة. فقبولُها «نصّية» بأربعين كلمة يعني إرسال ترويسةٍ إلى النموذج
 * وكتمانَ الفاتورة.
 */
export const MIN_INVOICE_WORDS = 60;

export type DocumentInput =
  | { mode: "TEXT"; text: string; pageCount: number; wordCount: number }
  | { mode: "IMAGE"; images: EmbeddedImage[]; source: "PDF_EMBEDDED" | "DIRECT" }
  | { mode: "UNREADABLE"; reason: string };

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * ترتيب الكلمات في الصفّ — والمستند ثنائيّ اللغة.
 *
 * ── لماذا لا يُستعمَل `groupIntoRows` ──
 *
 * ذاك مكتوبٌ لكشوف البنك السعودية، ويرتّب الصفّ **من اليمين إلى
 * اليسار** دائماً (`b.x - a.x`) — وهو صوابٌ في كشفٍ عربيّ كلّه.
 * وجُرِّب هنا على فاتورةٍ ثنائية فخرج اسم المورّد مقلوباً:
 * «Est. Trading Leaves Olive» بدل «Olive Leaves Trading Est.»،
 * و«1kg Beans Coffee Arabica» بدل «Arabica Coffee Beans 1kg».
 *
 * والمبالغ سلمت — لأنّ الرقم لا يُقلَب. فالعطب كان **صامتاً في
 * الأسماء وحدها**، وهي بالضبط ما تقوم عليه مطابقة المورّدين وأسماؤهم
 * البديلة. وفواتير المقهى فيها الإنجليزية كثيراً.
 *
 * ── والحلّ ليس قلب الاتجاه ──
 *
 * لو رُتّب من اليسار دائماً لانقلب العربيّ بدل الإنجليزيّ. والصفّ
 * الواحد هنا يحمل الاثنين معاً:
 *   «Seller: Olive Leaves Trading Est.    المورد: مؤسسة أوراق الزيتون»
 *
 * فالترتيب بالموضع أوّلاً (يسارٌ إلى يمين، وهو الترتيب البصريّ)، ثمّ
 * **تُعكَس كلّ سلسلةٍ عربية متّصلة** فتعود إلى ترتيبها المنطقيّ. وبه
 * يصحّ الطرفان في الصفّ الواحد.
 *
 * ولا يُمَسّ `groupIntoRows` نفسه: كشوف البنك مبنيّة عليه، وتغييرُ
 * دالّةٍ يعتمد عليها مسارٌ قائم يُبطل بأثرٍ رجعيّ ما بُني بها.
 */
export function layoutText(words: readonly PdfWord[]): string {
  const byPage = new Map<number, PdfWord[]>();
  for (const w of words) {
    const list = byPage.get(w.page) ?? [];
    list.push(w);
    byPage.set(w.page, list);
  }

  const out: string[] = [];

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const lines = new Map<number, PdfWord[]>();

    for (const w of byPage.get(page)!) {
      let key: number | undefined;
      for (const existing of lines.keys()) {
        if (Math.abs(existing - w.y) <= ROW_TOLERANCE) {
          key = existing;
          break;
        }
      }
      const at = key ?? w.y;
      const list = lines.get(at) ?? [];
      list.push(w);
      lines.set(at, list);
    }

    // الأعلى أوّلاً: محور الصفحة يصعد والقراءة تنزل
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      const visual = lines.get(y)!.sort((a, b) => a.x - b.x);

      const cells: string[] = [];
      let run: string[] = [];
      /*
        العلامات المعلَّقة.

        العلامة وحدها لا لغةَ لها، فلا يُعرَف موضعُها إلّا بما بعدها:
        نقطتان قبل سلسلةٍ عربية جزءٌ منها فتُعكَس معها، وقبل كلمةٍ
        لاتينية تبقى مكانها. فتُؤجَّل حتى تُعرَف صاحبتُها.
      */
      let pending: string[] = [];
      const flush = () => {
        if (run.length > 0) {
          cells.push(...run.reverse());
          run = [];
        }
      };

      for (const w of visual) {
        /*
          التوحيد إلى NFKC.

          ملفّات PDF كثيرة تخزّن العربية بـ«أشكال العرض» (ﻣﺆﺳﺴﺔ) لا
          بحروفها (مؤسسة) — وهما نصّان مختلفان بايتاً وإن تطابقا في
          العين. فلو مرّ شكلُ العرض كما هو لما التقى اسمُ المورّد باسمه
          المسجَّل عندنا أبداً، والمطابقة كلّها على الأسماء.

          وهذا توحيدُ **مدخَلٍ يُقرأ**، لا كتابةٌ فوق دليل: النصّ الخام
          يبقى في الملفّ، وهذا ما يُرسَل إلى النموذج وحده.
        */
        const text = w.text.normalize("NFKC");

        // العلامات وحدها محايدة: تُؤجَّل حتى يتبيّن ما بعدها
        if (!/\p{L}|\p{N}/u.test(text)) {
          pending.push(text);
          continue;
        }

        if (ARABIC_RE.test(text)) {
          // المعلَّق يلتحق بالسلسلة العربية فيُعكَس معها
          run.push(...pending, text);
        } else {
          flush();
          cells.push(...pending, text);
        }
        pending = [];
      }

      // ما بقي معلَّقاً في آخر الصفّ يلتحق بسلسلته إن كانت مفتوحة
      if (run.length > 0) run.push(...pending);
      else cells.push(...pending);
      flush();

      out.push(cells.join("  "));
    }
  }

  return out.join("\n");
}

/**
 * يقرّر المسار.
 *
 * ولا يرمي: كلّ عطبٍ يعود `UNREADABLE` بسببه. لأنّ المستدعي مسارُ
 * رفعٍ يواجه المستخدم، ورميُ استثناءٍ فيه يُنتج صفحةً بيضاء بدل رسالةٍ
 * تقول ما العمل.
 */
export async function resolveDocumentInput(
  data: Buffer,
  mimeType: string,
): Promise<DocumentInput> {
  if (isDeepseekImageType(mimeType)) {
    return {
      mode: "IMAGE",
      source: "DIRECT",
      images: [{ data, mimeType: "image/jpeg", width: 0, height: 0 }],
    };
  }

  if (mimeType !== PDF_TYPE) {
    return { mode: "UNREADABLE", reason: `نوع ملف لا يُقرأ: ${mimeType}` };
  }

  let words: Awaited<ReturnType<typeof extractPdfWords>>;
  try {
    words = await extractPdfWords(data);
  } catch (e) {
    /*
      تعذّرت قراءة بنية الـPDF — وقد يكون مع ذلك صورةً تُنتزَع.
      فلا يُيأس هنا؛ يُجرَّب المسار الثاني.
    */
    const salvaged = extractEmbeddedJpegs(data);
    if (salvaged.length > 0) {
      return { mode: "IMAGE", images: salvaged, source: "PDF_EMBEDDED" };
    }
    return { mode: "UNREADABLE", reason: `تعذّرت قراءة الملفّ: ${(e as Error).message}` };
  }

  if (words.words.length >= MIN_INVOICE_WORDS) {
    return {
      mode: "TEXT",
      text: layoutText(words.words),
      pageCount: words.pageCount,
      wordCount: words.words.length,
    };
  }

  const images = extractEmbeddedJpegs(data);
  if (images.length > 0) {
    return { mode: "IMAGE", images, source: "PDF_EMBEDDED" };
  }

  /*
    لا نصّ يُقرأ ولا صورةَ تُنتزَع.

    غالباً مسحٌ بضغط `CCITTFax` أو `JBIG2` — وهما خارج ما ينتزعه
    `pdf-images.ts`، وذلك حدٌّ معلَن هناك. والقول «لم يُقرأ» هنا أصدق
    من إرسال صفحةٍ فارغة إلى النموذج ثمّ عرضِ ما يخترعه.
  */
  return {
    mode: "UNREADABLE",
    reason:
      words.words.length === 0
        ? "ملفّ PDF مصوَّر بضغطٍ لا يُنتزَع منه صورة — يحتاج قراءةً يدوية"
        : `نصّ الملفّ أقلّ من أن يُقرأ (${words.words.length} كلمة) ولا صورةَ فيه`,
  };
}
