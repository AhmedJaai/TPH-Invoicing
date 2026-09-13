-- ═══════════════════════════════════════════════════════════════
-- فهارس ناقصة — لا أثر اليوم، والحجم يكبر
--
-- «المسدَّد من الفاتورة» يُحسَب في كلّ شاشة ومؤثِّر `026` بـ
-- `where invoice_id = …`، والفهرس الوحيد `(payment_id, invoice_id)` لا
-- يخدمه — فـEXPLAIN يُظهر مسحاً كاملاً لكلّ فاتورة. ومعه ما يُقرأ في كلّ
-- مزامنةٍ ورفع (`accounts.user_id`) وفي كلّ تراجع (`matched_payment_id`).
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON payment_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS bank_tx_matched_payment_idx ON bank_transactions (matched_payment_id);
CREATE INDEX IF NOT EXISTS bank_tx_import_idx ON bank_transactions (bank_import_id);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
