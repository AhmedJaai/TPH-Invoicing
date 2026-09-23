/**
 * دورةُ الجرد: يبدأ · يُختار نطاقُه · يُدخَل افتتاحيُّه وعدُّه · يُقفَل ·
 * يُعاد فتحُه.
 *
 * **ولا يُؤخَذ من المتصفّح إلّا ما لا يعرفه غيرُ الإنسان**: العدُّ
 * الفعليّ، والافتتاحيُّ حين لا مصدرَ له، ونطاقُ الجرد. وكلُّ ما عداه
 * يُشتقّ هنا. والطلبُ يُفحَص وقتَ التشغيل (`count-request.ts`) قبل أن
 * يبلغ الخدمة — لا بـ`as Body`.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import {
  CountLockedError, NotAWeekError, OverlappingPeriodError, ScopeItemNotInCountError,
  canonicalCounts, finaliseCount, recomputeCount, reopenCount, saveActualCounts, saveCountScope,
  setOpenings, startCount,
} from "@/services/inventory.service";
import { parseCountRequest } from "@/lib/inventory/count-request";
import { ITEM, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-count", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  const parsed = parseCountRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.request;

  try {
    switch (body.action) {
      case "start": {
        const { countId, created } = await startCount({
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          branchId: body.branchId ?? null,
          note: body.note ?? null,
          actorId: user.id,
        });
        await recomputeCount(countId);
        return NextResponse.json({
          ok: true, countId, created,
          message: created ? "بدأ الجرد — اختر ما يُعَدّ ثمّ راجِع ما دخل وما خرج." : "هذه الفترة لها جردٌ مفتوحٌ أصلاً — فُتح.",
        });
      }

      /*
        ── النطاق: طلبٌ واحد، ومعاملةٌ واحدة ──

        المجموعتان تصلان معاً، ويُكتبان معاً أو لا يُكتب شيء. وبعده
        يصير النطاقُ صريحاً ولا يمسّه التوريث.
      */
      case "scope": {
        const r = await saveCountScope(body.countId, { included: body.included, excluded: body.excluded }, user.id);
        return NextResponse.json({
          ok: true,
          message: `حُفظ النطاق — يُعَدّ ما اخترتَه${r.excluded > 0 ? `، و${countNoun(r.excluded, ITEM)} خارجه` : ""}.`,
        });
      }

      case "save": {
        /* الوحدةُ من الشاشة، والتحويلُ وفحصُ العائلة في الخادم */
        const entries = await canonicalCounts(
          body.entries.map((e) => ({ productId: e.productId, milli: e.actual, unit: e.unit })),
        );
        await saveActualCounts(body.countId, entries, user.id);
        return NextResponse.json({ ok: true, message: `حُفظ عدُّ ${countNoun(entries.length, ITEM)}` });
      }

      /*
        ── الرصيدُ الافتتاحيّ يدوياً ──

        يغلب الجردَ السابق صراحةً ويُحفَظ مصدرُه. والفراغُ يُفرغه فيعود
        إلى ما دونه أو «غير معروف» — لا صفراً.
      */
      case "opening": {
        const r = await setOpenings(
          body.countId,
          body.entries.map((e) => ({ productId: e.productId, enteredMilli: e.quantity, unit: e.unit, note: e.note ?? null })),
          user.id,
        );
        const parts = [
          r.set > 0 ? `كُتب الرصيدُ الافتتاحيّ لـ${countNoun(r.set, ITEM)}` : null,
          r.cleared > 0 ? `وأُفرغ لـ${countNoun(r.cleared, ITEM)} فعاد غيرَ معروف` : null,
        ].filter(Boolean);
        return NextResponse.json({ ok: true, message: parts.length > 0 ? `${parts.join(" ")}.` : "لا تغيير." });
      }

      case "recompute": {
        await recomputeCount(body.countId);
        return NextResponse.json({ ok: true, message: "أُعيد حسابُ الجرد على أحدث البيانات." });
      }

      case "finalise": {
        const report = await finaliseCount(body.countId, user.id);
        return NextResponse.json({
          ok: true,
          message: `أُقفل الجرد — ${countNoun(report.totals.linesCounted, ITEM)} عُدّت، والتقريرُ محفوظٌ كما هو.`,
        });
      }

      case "reopen": {
        /*
          إعادةُ الفتح تُعيد كتابةَ تقريرٍ مقفَل — فللمالك وحده،
          **وبصلاحيّتها هي** لا بصلاحيّة إقفال الشهر: فعلان على
          بياناتٍ مختلفة، والمشتركةُ تُوسّع الأذن بلا قصد.
        */
        try {
          await guard("inventory-reopen", "inventory:reopen");
        } catch (e) {
          const mapped = respondTo(e);
          if (mapped) return mapped;
          throw e;
        }
        await reopenCount(body.countId, body.reason, user.id);
        return NextResponse.json({ ok: true, message: "أُعيد فتحُ الجرد — والسببُ في سجلّ التدقيق." });
      }
    }
  } catch (e) {
    if (
      e instanceof CountLockedError || e instanceof OverlappingPeriodError
      || e instanceof NotAWeekError || e instanceof ScopeItemNotInCountError
    ) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
