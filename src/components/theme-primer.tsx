import { AMOUNTS_KEY, THEME_KEY } from "@/lib/view-prefs";

/**
 * يكتب التفضيل على `<html>` قبل أوّل رسم.
 *
 * مكوّنُ خادم: كان في ملفّ المتصفّح، فيُرسم ثانيةً عند الإحياء وتقول React «وُجد وسمُ نصٍّ
 * لا يُنفَّذ» — ويُنفَّذ مرّةً من الخادم كما يجب.
 *
 * يُركَّب في `<head>` بـ`dangerouslySetInnerHTML` لأنّ هذا هو السبيل
 * الوحيد لتشغيل نصٍّ قبل أن يُرسَم الجسم — والنصّ من عندنا لا من مدخلٍ
 * خارجيّ، ولا يقرأ إلّا مفتاحين من تخزين هذا الجهاز.
 */
export function ThemePrimer() {
  const js = `(function(){try{
    var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);
    if(localStorage.getItem(${JSON.stringify(AMOUNTS_KEY)})==="hidden")
      document.documentElement.setAttribute("data-amounts","hidden");
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
