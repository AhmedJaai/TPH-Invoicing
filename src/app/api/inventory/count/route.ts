/**
 * دورةُ الجرد: يبدأ · يُدخَل فيه العدّ · يُقفَل · يُعاد فتحُه.
 *
 * **ولا يُؤخَذ من المتصفّح إلّا العدُّ الفعليّ ومعرّفُ الصنف.** كلُّ ما
 * عداه يُشتقّ في الخادم: الافتتاحيُّ والمشترياتُ والاستهلاكُ والكلفة.
 * والدرسُ من `confirm.ts`: لا يُصدَّق المتصفّح في رقمٍ يُبنى عليه قرار.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import {
  CountLockedError, NotAWeekError, OverlappingPeriodError, finaliseCount, recomputeCount, reopenCount,
  saveActualCounts, setCountScope, startCount, type ActualInput,
} from "@/services/inventory.service";
import { decimalToMilli, toCanonical } from "@/lib/inventory/units";
import { isStoredUnit } from "@/lib/unit-conversion";
import { ITEM, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Entry {
  productId?: string;
  /** الكمّيّة كما كتبها الإنسان، بوحدة الصنف — «10.5». والفراغُ يعني «لم يُعَدّ». */
  actual?: string | number | null;
  unit?: string;
}

interface Body {
  action?: "start" | "save" | "scope" | "finalise" | "reopen" | "recompute";
  countId?: string;
  periodStart?: string;
  periodEnd?: string;
  branchId?: string | null;
  note?: string | null;
  reason?: string;
  entries?: Entry[];
  /** أصنافٌ بأعيانها يُغيَّر نطاقُها — مع `inScope`. */
  productIds?: string[];
  inScope?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-count", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "start": {
        if (!DATE.test(body.periodStart ?? "") || !DATE.test(body.periodEnd ?? "")) {
          return NextResponse.json({ error: "حدِّد فترةً بصيغة YYYY-MM-DD" }, { status: 400 });
        }
        const { countId, created } = await startCount({
          periodStart: body.periodStart!,
          periodEnd: body.periodEnd!,
          branchId: body.branchId ?? null,
          note: body.note ?? null,
          actorId: user.id,
        });
        await recomputeCount(countId);
        return NextResponse.json({
          ok: true, countId, created,
          message: created ? "بدأ الجرد — راجِع الجاهزيّة ثمّ أدخِل العدّ." : "هذه الفترة لها جردٌ مفتوحٌ أصلاً — فُتح.",
        });
      }

      /*
        ── النطاق: أيُّ الأصناف يُحسَب في هذا الجرد ──

        ولا يُؤخَذ من المتصفّح إلّا معرّفاتُ الأصناف وأينها من الجرد.
        والاستبعادُ لا يمحو عدّاً مكتوباً، ولا يُقرأ صفراً على الرفّ.
      */
      case "scope": {
        if (!body.countId) return NextResponse.json({ error: "لم يُحدَّد الجرد" }, { status: 400 });
        if (typeof body.inScope !== "boolean") {
          return NextResponse.json({ error: "لم يُحدَّد أداخلٌ هو أم خارج" }, { status: 400 });
        }
        const ids = (body.productIds ?? []).filter((x) => typeof x === "string" && x.length > 0);
        if (ids.length === 0) return NextResponse.json({ error: "لم يُحدَّد صنف" }, { status: 400 });

        const { changed } = await setCountScope(body.countId, ids, body.inScope, user.id);
        return NextResponse.json({
          ok: true,
          message: body.inScope
            ? `أُدخل ${countNoun(changed, ITEM)} في الجرد.`
            : `أُخرج ${countNoun(changed, ITEM)} من الجرد — وقائعُه محسوبة ولا فرقَ له.`,
        });
      }

      case "save": {
        if (!body.countId) return NextResponse.json({ error: "لم يُحدَّد الجرد" }, { status: 400 });
        const entries: ActualInput[] = [];
        for (const e of body.entries ?? []) {
          if (!e.productId) continue;
          const raw = e.actual;
          if (raw === null || raw === undefined || String(raw).trim() === "") {
            entries.push({ productId: e.productId, actualMilli: null });
            continue;
          }
          const milli = decimalToMilli(typeof raw === "number" ? raw : String(raw).trim());
          if (milli === null || milli < 0) {
            return NextResponse.json(
              { error: `كمّيّةٌ غير مقروءة: «${String(raw)}» — اكتب رقماً موجباً` },
              { status: 400 },
            );
          }
          /*
            الوحدةُ تأتي من الشاشة لأنّ الإنسان قد يعدّ بالجرام وصنفُه
            بالكيلو. وتُفحَص هنا، والتحويلُ إلى المعياريّ في الخادم —
            فلا يصل رقمٌ محوَّلٌ في المتصفّح.
          */
          const unit = e.unit;
          if (unit !== undefined && !isStoredUnit(unit)) {
            return NextResponse.json({ error: "وحدةٌ غير معروفة" }, { status: 400 });
          }
          entries.push({
            productId: e.productId,
            actualMilli: unit ? toCanonical(milli, unit) : milli,
          });
        }

        await saveActualCounts(body.countId, entries, user.id);
        return NextResponse.json({
          ok: true,
          message: `حُفظ عدُّ ${countNoun(entries.length, ITEM)}`,
        });
      }

      case "recompute": {
        if (!body.countId) return NextResponse.json({ error: "لم يُحدَّد الجرد" }, { status: 400 });
        await recomputeCount(body.countId);
        return NextResponse.json({ ok: true, message: "أُعيد حسابُ الجرد على أحدث البيانات." });
      }

      case "finalise": {
        if (!body.countId) return NextResponse.json({ error: "لم يُحدَّد الجرد" }, { status: 400 });
        const report = await finaliseCount(body.countId, user.id);
        return NextResponse.json({
          ok: true,
          message: `أُقفل الجرد — ${countNoun(report.totals.linesCounted, ITEM)} عُدّت، والتقريرُ محفوظٌ كما هو.`,
        });
      }

      case "reopen": {
        if (!body.countId) return NextResponse.json({ error: "لم يُحدَّد الجرد" }, { status: 400 });
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
        await reopenCount(body.countId, body.reason ?? "", user.id);
        return NextResponse.json({ ok: true, message: "أُعيد فتحُ الجرد — والسببُ في سجلّ التدقيق." });
      }

      default:
        return NextResponse.json({ error: "فعلٌ غير معروف" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof CountLockedError || e instanceof OverlappingPeriodError || e instanceof NotAWeekError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
