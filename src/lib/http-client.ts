/**
 * قراءة ردّ الخادم في المتصفّح — موضعٌ واحد لقاعدتين:
 *
 * ١. **الردّ يُقرأ نصّاً قبل أن يُدّعى أنّه JSON.** مهلة المنصّة (٥٠٤)
 *    وحدّ حجم الجسم (٤١٣) يصدران قبل أن تبلغ الشيفرة، فيعودان صفحةً
 *    نصّية. وكان `res.json()` يُستدعى بلا شرط في أربعة عشر موضعاً —
 *    منها أرشفة الفاتورة والإقفال والتراجع — فتنفجر الشاشة بـ«Unexpected
 *    token 'A'»: رسالةٌ عن المحلّل لا عن العطب.
 *
 * ٢. **«تعذّر الاتصال» تُقال حين لا يصل الطلب وحده.** وما ردّ عليه
 *    الخادم بخطأ عطبٌ عنده ومعه رمزُ حالته — وإلّا أُرسل صاحب العمل
 *    يفحص شبكةً سليمة.
 *
 * كانت القاعدتان مطبَّقتين في ستّة مواضع بستّ نسخٍ من الدالّة نفسها،
 * ومخالفتين في أربعة عشر. فصارت دالّةً واحدة، ويمنع اختبارٌ نصّيّ
 * `res.json()` في المكوّنات.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      /** صفرٌ حين لم يصل الطلب أصلاً. */
      status: number;
      /** رسالةٌ عربيّة لقارئها — من الخادم إن أرسلها، وإلّا بحسب الرمز. */
      error: string;
      /** ما في الردّ إن كان JSON — قد يحمل تفصيلاً (موانع، تقرير). */
      data: Partial<T> & Record<string, unknown>;
      /** انتهت الجلسة: ما لم يُحفظ باقٍ في الشاشة، والدخول يُعاد. */
      sessionExpired?: boolean;
    };

export const NETWORK_ERROR =
  "تعذّر الاتصال بالخادم — لم يصل الطلب. تحقّق من الشبكة ثمّ أعد المحاولة.";

/** رسالةٌ لرمز حالةٍ لم يرسل الخادمُ معه نصّاً يُقرأ. */
export function messageForStatus(status: number): string {
  if (status === 401) return "انتهت جلستك — سجّل الدخول ثانيةً، وما لم يُحفظ باقٍ في هذه الصفحة.";
  if (status === 403) return "هذا الفعل خارج صلاحيتك.";
  if (status === 413) return "الملفّ أكبر من الحدّ الذي يقبله الخادم — صغّره أو قسّمه ثمّ أعد المحاولة.";
  if (status === 429) return "تجاوزتَ حدّ الاستعمال مؤقّتاً — انتظر قليلاً ثمّ أعد المحاولة.";
  if (status === 504 || status === 502) {
    return "تأخّر الخادم فأُوقف الطلب قبل أن يكتمل — قد يكون بعضه حُفظ، فتحقّق قبل إعادة المحاولة.";
  }
  return `ردّ الخادم بخطأ (الرمز ${status}) — أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب.`;
}

export async function readResponse<T = Record<string, unknown>>(res: Response): Promise<ApiResult<T>> {
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ليس JSON — صفحة خطأٍ من المنصّة */
  }

  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;

  if (res.ok && obj) return { ok: true, status: res.status, data: obj as T };

  const serverMessage = obj && typeof obj.error === "string" ? obj.error : null;
  return {
    ok: false,
    status: res.status,
    error: res.ok
      ? `ردّ الخادم بما لا يُقرأ (الرمز ${res.status}) — أعد المحاولة.`
      : res.status === 401
        ? messageForStatus(401)
        : serverMessage ?? messageForStatus(res.status),
    data: (obj ?? {}) as Partial<T> & Record<string, unknown>,
    sessionExpired: res.status === 401 || undefined,
  };
}

/** الطلب والقراءة معاً — ويُفرَّق فيه بين «لم يصل» و«وصل فردّ بخطأ». */
export async function request<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    /* إلغاءٌ مقصود (بحثٌ أحدث) ليس عطب شبكة */
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, status: 0, error: NETWORK_ERROR, data: {} as Partial<T> & Record<string, unknown> };
  }
  return readResponse<T>(res);
}

export function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  init?: Omit<RequestInit, "method" | "body">,
): Promise<ApiResult<T>> {
  return request<T>(url, {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}
