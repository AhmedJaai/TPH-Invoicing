/**
 * «لماذا تغيّر الربح عن الشهر السابق؟» — جسرٌ من ربحِ شهرٍ إلى ربحِ الذي يليه.
 *
 * الربح = الإيراد − تكلفة المبيعات − مجموعُ أبواب المصروف (`pnl.ts`)، فالفرقُ بين شهرين
 * يُقسَم على هذه الأبواب قسمةً تامّة: مجموعُ الأسباب يساوي فرقَ الربح بالهللة. كلُّ سببٍ
 * أثرُه على الربح (ارتفاعُ مصروفٍ أثرٌ سالب)، مرتَّبةً بحجم الأثر.
 *
 * قراءةٌ فوق `Pnl` لا حساب ماليّ جديد: لا يُنشئ رقماً لم يحسبه `loadPnl`.
 * وما يجعل المقارنةَ غيرَ متكافئة (طريقةُ تكلفةٍ مختلفة، بابٌ أساسيّ ناقصٌ في أحدهما)
 * يُقال بجانبها ولا يُخفى.
 */
import type { Pnl } from "./pnl";

export interface BridgeDriver {
  /** معرّفُ السطر في قائمة الدخل (`revenue` · `cogs` · `op-RENT` …) — يُفتَح منه التفصيل. */
  id: string;
  label: string;
  /** أثرُه على الربح بالهللات: موجبٌ رفع الربح، وسالبٌ أنقصه. */
  impactMinor: number;
  /** المبلغُ في الشهرين — `null` حين لم يُسجَّل في أحدهما (غير معروف، لا صفر). */
  previousMinor: number | null;
  currentMinor: number | null;
}

export interface ProfitBridge {
  /** فرقُ الربح — يساوي مجموعَ `drivers` تماماً. */
  changeMinor: number;
  drivers: BridgeDriver[];
  /** ما يجعل المقارنةَ غيرَ متكافئة، بجملٍ تُعرض كما هي. */
  caveats: string[];
}

/**
 * الجسرُ بين `previous` و`current`، أو `null` حين لا يُعرف ربحُ أحدهما — لا فرقَ يُخترَع.
 * الأسبابُ الصغيرة جدّاً (أقلّ من ريال) تُسقط من القائمة وتبقى في المجموع.
 */
export function profitBridge(current: Pnl, previous: Pnl): ProfitBridge | null {
  if (current.profitMinor === null || previous.profitMinor === null) return null;
  if (current.revenueMinor === null || previous.revenueMinor === null) return null;
  if (current.cogsMinor === null || previous.cogsMinor === null) return null;

  const drivers: BridgeDriver[] = [
    {
      id: "revenue", label: "الإيراد",
      impactMinor: current.revenueMinor - previous.revenueMinor,
      previousMinor: previous.revenueMinor, currentMinor: current.revenueMinor,
    },
    {
      id: "cogs", label: "تكلفة المبيعات",
      impactMinor: -(current.cogsMinor - previous.cogsMinor),
      previousMinor: previous.cogsMinor, currentMinor: current.cogsMinor,
    },
  ];

  const opex = (p: Pnl) => new Map(p.opexByCategory.map((x) => [x.category as string, x]));
  const cur = opex(current);
  const prev = opex(previous);
  for (const category of new Set([...cur.keys(), ...prev.keys()])) {
    const c = cur.get(category);
    const p = prev.get(category);
    drivers.push({
      id: `op-${category}`,
      label: (c ?? p)!.label,
      impactMinor: -((c?.amountMinor ?? 0) - (p?.amountMinor ?? 0)),
      previousMinor: p?.amountMinor ?? null,
      currentMinor: c?.amountMinor ?? null,
    });
  }

  const changeMinor = current.profitMinor - previous.profitMinor;
  const caveats: string[] = [];
  if (current.cogsMethod !== previous.cogsMethod) {
    caveats.push("تكلفة المبيعات محسوبة بطريقتين مختلفتين في الشهرين (بالجرد وبالمشتريات)، ففرقها يحمل اختلاف الطريقة.");
  }
  if (current.profitLabel.split(" — ")[0] !== previous.profitLabel.split(" — ")[0]) {
    caveats.push(`الرقمان لا يشملان الشيء نفسه: «${previous.profitLabel}» مقابل «${current.profitLabel}».`);
  }

  return {
    changeMinor,
    drivers: drivers
      .filter((d) => Math.abs(d.impactMinor) >= 100)
      .sort((a, b) => Math.abs(b.impactMinor) - Math.abs(a.impactMinor)),
    caveats,
  };
}
