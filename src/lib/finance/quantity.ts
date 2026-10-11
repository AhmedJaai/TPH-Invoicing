import { canonicalToQuantity } from "@/lib/inventory/units";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";

/** الوحدةُ التي يُقرأ بها الرقم: الكبرى حين يبلغها (٥٬٢٠٠ جرام تُقرأ «٥٫٢ كجم»). */
function displayUnit(canonical: number, unit: StoredUnit): StoredUnit {
  const value = Math.abs(canonicalToQuantity(canonical, unit));
  if (unit === "G" && value >= 1000) return "KG";
  if (unit === "ML" && value >= 1000) return "L";
  return unit;
}

/** كمّيّةٌ معياريّة للقراءة — بفواصل الآلاف وخانتين على الأكثر. `null` «غير معروف». */
export function readableQuantity(canonical: number | null, unit: StoredUnit): string {
  if (canonical === null) return "غير معروف";
  const shown = displayUnit(canonical, unit);
  const value = canonicalToQuantity(canonical, shown);
  const rounded = Math.round(value * 100) / 100;
  const text = Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${rounded < 0 ? "−" : ""}${text} ${storedUnitLabel(shown)}`;
}
