import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى «ما يحتاج انتباهك».
 *
 * كانت `/audit` خليطاً: مشاكل، وأسعار، وضريبة، ومستحقّات — بأسمٍ
 * تقنيّ لا يقول لصاحب المقهى ماذا يجد فيها. وقد تفرّق محتواها على
 * مساحاته: المشاكل إلى الانتباه، والأسعار إلى المشتريات، والضريبة إلى
 * المال.
 */
export default function LegacyAudit(): never {
  permanentRedirect("/attention");
}
