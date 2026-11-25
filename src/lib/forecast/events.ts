/** أنواعُ ما يعرفه أحمد ولا تعرفه البيانات — وما يفعله كلٌّ بالتنبّؤ. */
export const FORECAST_EVENT_KINDS = ["CLOSED", "STOCKOUT", "EVENT", "PROMO", "OTHER"] as const;
export type ForecastEventKind = (typeof FORECAST_EVENT_KINDS)[number];

export const FORECAST_EVENT_LABEL: Record<ForecastEventKind, string> = {
  CLOSED: "إغلاق",
  STOCKOUT: "نفاد صنف",
  EVENT: "فعاليّة أو مناسبة",
  PROMO: "عرض أو خصم",
  OTHER: "غير ذلك",
};

export const FORECAST_EVENT_HINT: Record<ForecastEventKind, string> = {
  CLOSED: "اليومُ يخرج من التعلّم، والمستقبلُ منه يُتنبّأ له بصفر.",
  STOCKOUT: "ما بيع من الصنف ذلك اليوم ليس طلبَه الحقيقيّ، فيخرج من تعلّمه.",
  EVENT: "يراه النموذجُ متغيّراً، ويتعلّم أثرَه كلّما تكرّر.",
  PROMO: "يراه النموذجُ متغيّراً، ويتعلّم أثرَه كلّما تكرّر.",
  OTHER: "يُحفظ ليُقرأ مع الأرقام، ويراه النموذجُ متغيّراً.",
};

export function isForecastEventKind(v: string): v is ForecastEventKind {
  return (FORECAST_EVENT_KINDS as readonly string[]).includes(v);
}
