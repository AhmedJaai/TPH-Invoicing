/**
 * أخطاءُ العمل المعروفة — برمزها ونصّها العربيّ، تُترجَم في موضعٍ واحد.
 *
 * كان كلُّ مسارٍ يكتب `NextResponse.json({ error }, { status })` بيده في كلّ فرعِ
 * رفض، وكلُّ خدمةٍ تُعرّف صنفَ خطئها وتنتظر من المسار أن يتذكّر رمزه. فالخدمةُ
 * الآن ترمي واحداً من هذه، و`respondTo` (`services/guard.ts`) يقول الردَّ:
 * `{ error: message, ...payload }` بالرمز نفسه — الشكلُ الذي تقرؤه الشاشات
 * (`lib/http-client.ts`).
 *
 * والنصُّ يقرؤه صاحبُ العمل: عربيٌّ يقول ما وقع وما العمل، لا اسمَ صنف.
 */
export type DomainStatus = 400 | 404 | 409 | 422 | 500;

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: DomainStatus,
    /** حقولٌ تُضاف إلى الردّ بجانب `error` — ما تحتاجه الشاشة لتعرض التفصيل. */
    readonly payload?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** طلبٌ لا يُنفَّذ كما جاء (٤٠٠): حقلٌ ناقص، أو إجراءٌ لا تجيزه القاعدة. */
export class Refused extends DomainError {
  constructor(message: string, payload?: Readonly<Record<string, unknown>>) {
    super(message, 400, payload);
  }
}

/** ما طُلب غير موجود (٤٠٤). */
export class NotFound extends DomainError {
  constructor(message: string, payload?: Readonly<Record<string, unknown>>) {
    super(message, 404, payload);
  }
}

/** الحالُ تغيّرت أو تمنع (٤٠٩): قُيّد من قبل، شهرٌ مقفل، ضغطتان. */
export class Conflict extends DomainError {
  constructor(message: string, payload?: Readonly<Record<string, unknown>>) {
    super(message, 409, payload);
  }
}

/** الملفُّ وصل ولا يُقرأ كما هو (٤٢٢) — كشفٌ مصوَّر لا يُخمَّن. */
export class Unreadable extends DomainError {
  constructor(message: string, payload?: Readonly<Record<string, unknown>>) {
    super(message, 422, payload);
  }
}
