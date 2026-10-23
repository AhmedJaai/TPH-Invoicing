-- 086 — راتبٌ دُفع خارج كشف البنك: نقداً أو من حساب المالك الشخصيّ بلا حوالةٍ تُعرف.
--
-- أحمد (٢٣ أكتوبر ٢٠٢٦) سجّل رواتب أغسطس بيده، ومنها خمسةٌ «غير ظاهرة في البنك» دفعها من حسابه.
-- لا حوالةَ يُربط بها، فتُسجَّل بنداً يُحسب ممّا دُفع له — ولا يمسّ قائمةَ الدخل (لا يُعرف مصدرُه).
--
-- توسيعُ قيدٍ قائم بقيمةٍ جديدة: الشيفرةُ القديمة لا تكتبها، وتتجاهلها في الحساب إن قرأتها.

alter table payroll_adjustments drop constraint if exists payroll_adjustments_kind_check;
alter table payroll_adjustments add constraint payroll_adjustments_kind_check
  check (kind in ('DEDUCTION', 'FINE', 'ADVANCE', 'LOAN_REPAYMENT', 'BONUS', 'OVERTIME', 'ALLOWANCE', 'LOAN_GIVEN', 'PAID_OUTSIDE'));
