-- 083 — سدادُ المورّد من مال المالك: أمِن تحويلات المقهى إليه أم من ماله الخاصّ؟
--
-- التحويلاتُ لحساب المالك مصروف (أحمد، ١٢ أكتوبر ٢٠٢٦). فإن سدّد منها فاتورةَ مورّدٍ نقداً
-- حُسب المبلغُ مرّتين: مصروفاً حين حُوِّل، ومشترياتٍ حين قُيِّدت فاتورتُه. فيُخصم من التحويلات —
-- **لما يحدّده أحمد وحده** (٢٢ أكتوبر ٢٠٢٦: «لا تسويها على كل المدفوعات، أنا أحدد — في أشياء
-- في مايو دفعتها من حسابي الشخصي مو من تحويلات الكافيه»).
--
-- إضافةٌ خالصة: عمودٌ أصله «لا»، فلا يتغيّر رقمٌ قائم حتّى يُعلَّم سدادٌ بعينه.

alter table payments add column if not exists from_owner_transfers boolean not null default false;

-- لا يُعلَّم إلّا سدادٌ من مال المالك: حوالةُ المقهى لم تمرّ بتحويلاته
alter table payments drop constraint if exists payments_owner_transfers_check;
alter table payments add constraint payments_owner_transfers_check
  check (not from_owner_transfers or method = 'OWNER_ACCOUNT');
