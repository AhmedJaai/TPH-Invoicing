/**
 * القاموسُ في المتصفّح — يُطلَب مرّةً واحدة ويشترك فيه `EnglishRuntime`
 * (ما يُرسم نصّاً) و`<T>` (الجملةُ المركّبة من نصٍّ وقيم). وعلى الخادم لا قاموس:
 * الرسمُ الأوّل عربيٌّ دائماً، فلا يختلف عن ربط React.
 */
import { DICTIONARY_URL } from "./locale";
import { Translator, type Dictionary } from "./translate";

let translator: Translator | null = null;
let pending: Promise<Translator> | null = null;
const listeners = new Set<() => void>();

export function loadTranslator(): Promise<Translator> {
  if (translator) return Promise.resolve(translator);
  pending ??= fetch(DICTIONARY_URL, { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Dictionary>) : Promise.reject(new Error(String(r.status)))))
    .then((dict) => {
      translator = new Translator(dict);
      listeners.forEach((l) => l());
      return translator;
    })
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

export function subscribeTranslator(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentTranslator(): Translator | null {
  return translator;
}
