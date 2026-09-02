-- سجل التدقيق غير قابل للتعديل ولا الحذف.
-- المنع على مستوى قاعدة البيانات نفسها لا على مستوى الكود، فلا يفلت
-- من خطأ برمجي ولا من استعلام يدوي — كما طلب المالك أن يكون السجل غير قابل للحذف.

CREATE OR REPLACE FUNCTION audit_logs_are_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'سجل التدقيق غير قابل للتعديل أو الحذف (محاولة %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

-- مشغّلات الصفوف لا تلتقط TRUNCATE، وهو ثغرة تُفرغ السجل كاملاً.
-- لذلك نضيف مشغّلاً على مستوى الجملة يسدّها.
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_are_append_only();
