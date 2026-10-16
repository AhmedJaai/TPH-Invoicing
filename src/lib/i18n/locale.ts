/**
 * لغةُ الواجهة — تفضيلٌ لهذا المتصفّح في كعكة، يقرؤها الخادمُ قبل أوّل رسم
 * فيكتب `lang` و`dir` على `<html>` ولا تنقلب الصفحةُ بعد ظهورها.
 *
 * العربيّةُ هي الأصل والشيفرةُ مكتوبةٌ بها؛ والإنجليزيّةُ ترجمةُ ما يُرسم
 * (`translate.ts`). والبياناتُ نفسها (أسماءُ المورّدين ونصوصُ المستندات) لا تُترجَم.
 */
export const LOCALE_COOKIE = "tph.locale";

export type Locale = "ar" | "en";

export function asLocale(v: string | undefined | null): Locale {
  return v === "en" ? "en" : "ar";
}

/** مسارُ القاموس — يُبنى بـ`node scripts/i18n/build-dictionary.mjs`. */
export const DICTIONARY_URL = "/i18n/en.json";
