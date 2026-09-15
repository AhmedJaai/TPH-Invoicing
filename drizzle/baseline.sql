-- أساس المخطّط — يُولَّد بـ npm run db:backup -- --baseline drizzle/baseline.sql ولا يُحرَّر باليد.
-- يُطبَّق على قاعدةٍ فارغة وحدها (npm run db:bootstrap)، ثمّ تُطبَّق فوقه الهجرات اللاحقة.
set check_function_bodies = off;

create extension if not exists pgcrypto with schema public;

create type "public"."alias_kind" as enum ('BANK_BENEFICIARY', 'NAME_VARIANT', 'VAT', 'FOLDER');

create type "public"."alias_source" as enum ('MIGRATION', 'MANUAL', 'LEARNED');

create type "public"."base_unit" as enum ('KG', 'G', 'L', 'ML', 'PIECE', 'PACK');

create type "public"."billing_cycle" as enum ('PER_DELIVERY', 'MONTHLY_STATEMENT');

create type "public"."classification_source" as enum ('STRUCTURE', 'MEMORY', 'RULE', 'KEYWORD', 'AI', 'HUMAN', 'UNKNOWN', 'AMOUNT');

create type "public"."counterparty_evidence_kind" as enum ('NAME', 'ACCOUNT', 'IBAN', 'NATIONAL_ID', 'MERCHANT_ID', 'REFERENCE', 'PATTERN');

create type "public"."decision_event" as enum ('CLASSIFIED', 'MATCH_SUGGESTED', 'MATCH_CONFIRMED', 'MATCH_REJECTED', 'MATCH_REVERSED', 'ENTITY_LEARNED', 'POSTED');

create type "public"."document_kind" as enum ('TAX_INVOICE', 'SIMPLIFIED_INVOICE', 'STATEMENT', 'QUOTATION', 'PROFORMA', 'RECEIPT', 'CASH_RECEIPT', 'CONTRACT', 'UTILITY', 'UNKNOWN');

create type "public"."document_status" as enum ('PENDING', 'EXTRACTED', 'NEEDS_REVIEW', 'ARCHIVED', 'REJECTED');

create type "public"."expense_source" as enum ('BANK', 'INVOICE', 'MANUAL');

create type "public"."input_vat_status" as enum ('ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN');

create type "public"."issue_severity" as enum ('INFO', 'WARN', 'BLOCKER');

create type "public"."issue_status" as enum ('OPEN', 'RESOLVED', 'WAIVED');

create type "public"."match_disposition" as enum ('AUTO', 'SUGGEST', 'REVIEW');

create type "public"."match_status" as enum ('UNMATCHED', 'MATCHED', 'PARTIAL', 'DISPUTED', 'IGNORED');

create type "public"."month_close_status" as enum ('OPEN', 'IN_REVIEW', 'CLOSED');

create type "public"."payment_method" as enum ('BANK_TRANSFER', 'CASH', 'EMPLOYEE_ADVANCE', 'OWNER_ACCOUNT');

create type "public"."payment_status" as enum ('UNAPPLIED', 'PARTIALLY_APPLIED', 'APPLIED', 'OVERPAYMENT', 'ADVANCE', 'REVERSED', 'VOID');

create type "public"."product_category" as enum ('COFFEE', 'DAIRY', 'BAKERY', 'FOOD', 'BEVERAGE', 'PACKAGING', 'CLEANING', 'EQUIPMENT', 'OTHER');

create type "public"."reconciliation_status" as enum ('OPEN', 'IN_PROGRESS', 'RECONCILED', 'DISCREPANCY');

create type "public"."role" as enum ('OWNER', 'ACCOUNTANT', 'PURCHASING');

create type "public"."rule_source" as enum ('MANUAL', 'SUGGESTED');

create type "public"."sale_payment_method" as enum ('CASH', 'MADA', 'VISA', 'MASTERCARD', 'AMEX', 'APPLE_PAY', 'STC_PAY', 'TRANSFER', 'OTHER');

create type "public"."supplier_category" as enum ('COFFEE', 'FOOD', 'PACKAGING', 'EQUIPMENT', 'WATER', 'UTILITIES', 'OTHER');

create type "public"."tax_status" as enum ('VALID', 'INVALID', 'UNKNOWN', 'NOT_APPLICABLE');

create type "public"."tx_category" as enum ('SUPPLIER', 'SALARY', 'RENT', 'ZAKAT', 'UTILITY', 'GOVERNMENT', 'PERSONAL', 'INTERNAL', 'OTHER', 'UNKNOWN', 'POS_SETTLEMENT', 'POS_FEE', 'POS_VAT', 'BANK_FEE', 'BANK_VAT');

create type "public"."tx_direction" as enum ('DEBIT', 'CREDIT');

create type "public"."tx_lifecycle" as enum ('RAW', 'INFERRED', 'SUGGESTED', 'CONFIRMED', 'POSTED');

CREATE OR REPLACE FUNCTION public.assert_allocation_within_bounds()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  payment_total   integer;
  allocated_total bigint;
  invoice_total   integer;
  invoice_alloc   bigint;
begin
  /*
    القفل أوّلاً — قبل أيّ جمع.

    `for update` يحجز الصفّ حتى نهاية المعاملة، فتصطفّ المعاملات
    المتزاحمة على الفاتورة الواحدة بدل أن تقرأ كلٌّ منها حالاً قديماً.
    و`perform` لأنّ المطلوب القفل لا القيمة.
  */
  perform 1 from payments  where id = new.payment_id for update;
  perform 1 from invoices  where id = new.invoice_id for update;

  select amount_minor into payment_total from payments where id = new.payment_id;
  select coalesce(sum(amount_minor), 0) into allocated_total
    from payment_allocations where payment_id = new.payment_id;

  if payment_total is not null and allocated_total > payment_total then
    raise exception
      'تخصيص أكبر من قيمة الدفعة: خُصّص % والدفعة %',
      allocated_total, payment_total
      using errcode = 'check_violation';
  end if;

  select total_minor into invoice_total from invoices where id = new.invoice_id;
  select coalesce(sum(amount_minor), 0) into invoice_alloc
    from payment_allocations where invoice_id = new.invoice_id;

  if invoice_total is not null and invoice_alloc > invoice_total then
    raise exception
      'سداد أكبر من قيمة الفاتورة: سُدّد % والفاتورة %',
      invoice_alloc, invoice_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_logs_are_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'سجل التدقيق غير قابل للتعديل أو الحذف (محاولة %)', TG_OP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.month_is_closed(m text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (SELECT 1 FROM month_closes WHERE month = m AND status = 'CLOSED');
$function$;

CREATE OR REPLACE FUNCTION public.payment_month(applies text, paid timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT coalesce(applies, to_char(paid, 'YYYY-MM'));
$function$;

CREATE OR REPLACE FUNCTION public.reject_closed_month_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE m text;
BEGIN
  SELECT period_month INTO m FROM invoices
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF month_is_closed(m) THEN
    RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل تغيير ما سُدّد من فواتيره', m
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

CREATE OR REPLACE FUNCTION public.reject_closed_month_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(NEW.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل إضافة فاتورة إليه', NEW.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF month_is_closed(OLD.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل حذف فاتورة منه', OLD.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.total_minor IS DISTINCT FROM OLD.total_minor
      OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
      OR NEW.vat_minor IS DISTINCT FROM OLD.vat_minor
      OR NEW.period_month IS DISTINCT FROM OLD.period_month
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id)
     AND (month_is_closed(OLD.period_month) OR month_is_closed(NEW.period_month)) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل مبلغ فاتورته أو شهرها'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.reject_closed_month_payment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(payment_month(NEW.applies_to_month, NEW.paid_at)) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل قيد دفعةٍ فيه',
        payment_month(NEW.applies_to_month, NEW.paid_at) USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.fee_minor IS DISTINCT FROM OLD.fee_minor
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.applies_to_month IS DISTINCT FROM OLD.applies_to_month
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at)
     AND (month_is_closed(payment_month(OLD.applies_to_month, OLD.paid_at))
          OR month_is_closed(payment_month(NEW.applies_to_month, NEW.paid_at))) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل دفعته' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

create table "public"."accounts" (
  "user_id" text not null,
  "type" text not null,
  "provider" text not null,
  "provider_account_id" text not null,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text
);

create table "public"."adjudications" (
  "id" text not null,
  "bank_transaction_id" text not null,
  "kind" text not null,
  "provider" text not null,
  "model" text not null,
  "prompt_version" text not null,
  "schema_version" text not null,
  "duration_ms" integer default 0 not null,
  "model_confidence" numeric(4,3),
  "model_reason" text,
  "claimed_codes" text[] default '{}'::text[] not null,
  "upheld_codes" text[] default '{}'::text[] not null,
  "refuted_codes" text[] default '{}'::text[] not null,
  "chosen_invoice_ids" text[] default '{}'::text[] not null,
  "chosen_counterparty" text,
  "disposition" match_disposition not null,
  "signals" jsonb,
  "refused" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."ai_findings" (
  "id" text not null,
  "supplier_id" text not null,
  "run_id" text not null,
  "kind" text not null,
  "severity" text not null,
  "title" text not null,
  "explanation" text not null,
  "amount_minor" integer,
  "action" jsonb,
  "refs" jsonb default '[]'::jsonb not null,
  "status" text default 'OPEN'::text not null,
  "model" text not null,
  "prompt_version" text not null,
  "model_confidence" numeric(4,3),
  "cost_micro_usd" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "decided_at" timestamp with time zone,
  "decided_by_id" text,
  "decision_note" text
);

create table "public"."audit_logs" (
  "id" text not null,
  "actor_id" text,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "before" jsonb,
  "after" jsonb,
  "at" timestamp with time zone default now() not null
);

create table "public"."bank_accounts" (
  "id" text not null,
  "branch_id" text,
  "bank_name" text not null,
  "label" text not null,
  "account_number" text not null,
  "iban" text,
  "currency" text default 'SAR'::text not null,
  "opening_balance_minor" integer,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."bank_imports" (
  "id" text not null,
  "file_name" text not null,
  "bank" text,
  "row_count" integer default 0 not null,
  "imported_by_id" text,
  "created_at" timestamp with time zone default now() not null,
  "file_sha256" text,
  "account_number" text,
  "new_row_count" integer default 0 not null,
  "bank_account_id" text,
  "period_start" text,
  "period_end" text
);

create table "public"."bank_rules" (
  "id" text not null,
  "pattern" text not null,
  "normalized" text not null,
  "category" tx_category not null,
  "supplier_id" text,
  "note" text,
  "source" rule_source default 'MANUAL'::rule_source not null,
  "created_by_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."bank_transactions" (
  "id" text not null,
  "bank_import_id" text not null,
  "value_date" timestamp with time zone not null,
  "description" text,
  "beneficiary_raw" text,
  "amount_minor" integer not null,
  "direction" tx_direction not null,
  "ref" text,
  "matched_payment_id" text,
  "match_status" match_status default 'UNMATCHED'::match_status not null,
  "category" tx_category default 'UNKNOWN'::tx_category not null,
  "rule_id" text,
  "external_id" text,
  "transaction_type" text,
  "match_disposition" match_disposition,
  "match_score" integer,
  "match_outcome" text,
  "match_evidence" jsonb,
  "supplier_id" text,
  "counterparty_id" text,
  "bank_account_id" text,
  "classification_source" classification_source,
  "classification_reason" text,
  "classification_version" text,
  "lifecycle" tx_lifecycle default 'RAW'::tx_lifecycle not null,
  "occurrence" integer default 0 not null,
  "operation_ref" text,
  "identity_key" text
);

create table "public"."branches" (
  "id" text not null,
  "name_ar" text not null,
  "name_en" text,
  "code" text not null,
  "city" text,
  "is_default" boolean default false not null,
  "is_active" boolean default true not null,
  "opened_on" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."counterparties" (
  "id" text not null,
  "display_name" text not null,
  "kind" tx_category default 'UNKNOWN'::tx_category not null,
  "supplier_id" text,
  "note" text,
  "is_active" boolean default true not null,
  "created_by_id" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."counterparty_evidence" (
  "id" text not null,
  "counterparty_id" text not null,
  "kind" counterparty_evidence_kind not null,
  "value" text not null,
  "normalized" text not null,
  "confirmations" integer default 1 not null,
  "confirmed_by_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."decision_history" (
  "id" text not null,
  "bank_transaction_id" text,
  "event" decision_event not null,
  "actor" text not null,
  "actor_id" text,
  "detail" text,
  "payload" jsonb,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."documents" (
  "id" text not null,
  "drive_file_id" text,
  "drive_folder_id" text,
  "file_name" text not null,
  "mime_type" text not null,
  "size_bytes" integer,
  "sha256" text,
  "kind" document_kind default 'UNKNOWN'::document_kind not null,
  "status" document_status default 'PENDING'::document_status not null,
  "period_month" text,
  "supplier_id" text,
  "raw_text" text,
  "text_source" text,
  "extraction_json" jsonb,
  "extraction_model" text,
  "field_confidence" jsonb,
  "uploaded_by_id" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."expenses" (
  "id" text not null,
  "period_month" text not null,
  "occurred_on" text not null,
  "category" tx_category not null,
  "label" text not null,
  "amount_minor" integer not null,
  "source" expense_source not null,
  "bank_transaction_id" text,
  "invoice_id" text,
  "recurring_expense_id" text,
  "note" text,
  "created_by_id" text,
  "created_at" timestamp with time zone default now() not null,
  "branch_id" text,
  "event_key" text
);

create table "public"."extraction_cache" (
  "sha256" text not null,
  "extraction" jsonb not null,
  "model" text,
  "user_id" text,
  "created_at" timestamp with time zone default now() not null,
  "text_source" text
);

create table "public"."invoice_lines" (
  "id" text not null,
  "invoice_id" text not null,
  "description" text not null,
  "qty" numeric(12,3) default '1'::numeric not null,
  "unit_price_minor" integer not null,
  "line_total_minor" integer not null,
  "vat_rate" numeric(5,4) default 0.15 not null,
  "normalized_description" text default ''::text not null,
  "invoice_date" timestamp with time zone,
  "supplier_id" text,
  "list_unit_price_minor" integer,
  "discount_minor" integer default 0 not null,
  "pricing_basis" text,
  "supplier_product_id" text
);

create table "public"."invoices" (
  "id" text not null,
  "document_id" text not null,
  "supplier_id" text not null,
  "invoice_number" text not null,
  "invoice_date" timestamp with time zone not null,
  "period_month" text not null,
  "subtotal_minor" integer,
  "vat_minor" integer,
  "total_minor" integer not null,
  "seller_vat" text,
  "buyer_vat" text,
  "is_fixed_asset" boolean default false not null,
  "posted_to_accounting" boolean default false not null,
  "posted_at" timestamp with time zone,
  "posting_ref" text,
  "carried_forward_from" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tax_status" tax_status default 'UNKNOWN'::tax_status not null,
  "input_vat_status" input_vat_status default 'UNKNOWN'::input_vat_status not null,
  "branch_id" text
);

create table "public"."issues" (
  "id" text not null,
  "code" text not null,
  "severity" issue_severity not null,
  "status" issue_status default 'OPEN'::issue_status not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "message" text not null,
  "resolved_by_id" text,
  "resolved_at" timestamp with time zone,
  "waiver_reason" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."month_closes" (
  "id" text not null,
  "month" text not null,
  "status" month_close_status default 'OPEN'::month_close_status not null,
  "checklist" jsonb,
  "closed_by_id" text,
  "closed_at" timestamp with time zone
);

create table "public"."payment_allocations" (
  "id" text not null,
  "payment_id" text not null,
  "invoice_id" text not null,
  "amount_minor" integer not null
);

create table "public"."payments" (
  "id" text not null,
  "document_id" text,
  "supplier_id" text,
  "paid_at" timestamp with time zone not null,
  "amount_minor" integer not null,
  "method" payment_method default 'BANK_TRANSFER'::payment_method not null,
  "beneficiary_name_raw" text,
  "applies_to_month" text,
  "created_at" timestamp with time zone default now() not null,
  "status" payment_status default 'UNAPPLIED'::payment_status not null,
  "fee_minor" integer default 0 not null,
  "is_advance" boolean default false not null,
  "reversed_at" timestamp with time zone,
  "reversed_by_id" text,
  "reversal_reason" text,
  "voided_at" timestamp with time zone
);

create table "public"."pos_products" (
  "id" text not null,
  "source_id" text not null,
  "external_id" text not null,
  "name" text not null,
  "category" text,
  "price_minor" integer,
  "product_id" text,
  "created_at" timestamp with time zone default now() not null,
  "branch_id" text
);

create table "public"."products" (
  "id" text not null,
  "name_ar" text not null,
  "name_en" text,
  "category" product_category default 'OTHER'::product_category not null,
  "base_unit" base_unit default 'PIECE'::base_unit not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."rate_limits" (
  "key" text not null,
  "window_start" timestamp with time zone not null,
  "count" integer default 0 not null
);

create table "public"."reconciliation_periods" (
  "id" text not null,
  "bank_account_id" text not null,
  "period_start" text not null,
  "period_end" text not null,
  "opening_balance_minor" integer,
  "closing_balance_minor" integer,
  "imported_count" integer default 0 not null,
  "matched_count" integer default 0 not null,
  "difference_minor" integer,
  "status" reconciliation_status default 'OPEN'::reconciliation_status not null,
  "reviewed_by_id" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."recurring_expenses" (
  "id" text not null,
  "label" text not null,
  "category" tx_category not null,
  "amount_minor" integer not null,
  "cadence" text default 'MONTHLY'::text not null,
  "starts_on" date,
  "ends_on" date,
  "note" text,
  "is_active" boolean default true not null,
  "created_by_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."refund_lines" (
  "id" text not null,
  "refund_id" text not null,
  "pos_product_id" text,
  "description" text not null,
  "quantity" numeric(12,3) default 1 not null,
  "amount_minor" integer not null
);

create table "public"."refunds" (
  "id" text not null,
  "sale_id" text,
  "source_id" text not null,
  "external_id" text not null,
  "branch_id" text,
  "refunded_at" timestamp with time zone not null,
  "business_date" text not null,
  "amount_minor" integer not null,
  "reason" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."sale_lines" (
  "id" text not null,
  "sale_id" text not null,
  "pos_product_id" text,
  "description" text not null,
  "quantity" numeric(12,3) default 1 not null,
  "unit_price_minor" integer not null,
  "line_total_minor" integer not null,
  "external_id" text
);

create table "public"."sale_payments" (
  "id" text not null,
  "sale_id" text not null,
  "method" sale_payment_method not null,
  "amount_minor" integer not null,
  "external_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."sales" (
  "id" text not null,
  "source_id" text not null,
  "external_id" text not null,
  "sold_at" timestamp with time zone not null,
  "business_date" date not null,
  "gross_minor" integer not null,
  "discount_minor" integer default 0 not null,
  "refund_minor" integer default 0 not null,
  "vat_minor" integer default 0 not null,
  "net_minor" integer not null,
  "order_count" integer default 1 not null,
  "created_at" timestamp with time zone default now() not null,
  "branch_id" text
);

create table "public"."sales_sources" (
  "id" text not null,
  "name" text not null,
  "kind" text default 'POS'::text not null,
  "is_connected" boolean default false not null,
  "last_sync_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."schema_migrations" (
  "name" text not null,
  "sha256" text not null,
  "applied_at" timestamp with time zone default now() not null
);

create table "public"."sessions" (
  "session_token" text not null,
  "user_id" text not null,
  "expires" timestamp with time zone not null
);

create table "public"."settlement_batches" (
  "id" text not null,
  "source_id" text,
  "branch_id" text,
  "merchant_id" text,
  "scheme" text,
  "batch_date" text not null,
  "external_id" text,
  "gross_minor" integer default 0 not null,
  "fee_minor" integer default 0 not null,
  "vat_minor" integer default 0 not null,
  "net_minor" integer default 0 not null,
  "bank_transaction_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."statement_lines" (
  "id" text not null,
  "statement_id" text not null,
  "date" timestamp with time zone not null,
  "ref" text,
  "description" text,
  "debit_minor" integer default 0 not null,
  "credit_minor" integer default 0 not null,
  "matched_invoice_id" text,
  "match_status" match_status default 'UNMATCHED'::match_status not null
);

create table "public"."statements" (
  "id" text not null,
  "document_id" text not null,
  "supplier_id" text not null,
  "period_start" timestamp with time zone not null,
  "period_end" timestamp with time zone not null,
  "opening_balance_minor" integer,
  "closing_balance_minor" integer,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."supplier_aliases" (
  "id" text not null,
  "supplier_id" text not null,
  "value" text not null,
  "normalized" text not null,
  "kind" alias_kind not null,
  "source" alias_source default 'MANUAL'::alias_source not null,
  "confidence" double precision default 1 not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."supplier_products" (
  "id" text not null,
  "supplier_id" text not null,
  "normalized_description" text not null,
  "display_name" text not null,
  "product_id" text,
  "pack_size" numeric(12,3),
  "confirmed_by_id" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "content_unit" base_unit,
  "content_quantity" numeric(12,3)
);

create table "public"."suppliers" (
  "id" text not null,
  "slug" text not null,
  "drive_folder_name" text not null,
  "name_ar" text not null,
  "name_en" text,
  "vat_number" text,
  "cr_number" text,
  "category" supplier_category default 'OTHER'::supplier_category not null,
  "billing_cycle" billing_cycle default 'PER_DELIVERY'::billing_cycle not null,
  "payment_terms" text,
  "issues_invoices" boolean default true not null,
  "contract_on_file" boolean default false not null,
  "contract_drive_file_id" text,
  "balance_alert_minor" integer,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."users" (
  "id" text not null,
  "name" text,
  "email" text not null,
  "email_verified" timestamp with time zone,
  "image" text,
  "role" role default 'PURCHASING'::role not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."verification_tokens" (
  "identifier" text not null,
  "token" text not null,
  "expires" timestamp with time zone not null
);

alter table "public"."accounts" add constraint "accounts_provider_provider_account_id_pk" PRIMARY KEY (provider, provider_account_id);
alter table "public"."adjudications" add constraint "adjudications_confidence_range" CHECK (((model_confidence IS NULL) OR ((model_confidence >= (0)::numeric) AND (model_confidence <= (1)::numeric))));
alter table "public"."adjudications" add constraint "adjudications_pkey" PRIMARY KEY (id);
alter table "public"."ai_findings" add constraint "ai_findings_decision_marks" CHECK (((status = ANY (ARRAY['OPEN'::text, 'SUPERSEDED'::text])) OR (decided_at IS NOT NULL)));
alter table "public"."ai_findings" add constraint "ai_findings_kind_check" CHECK ((kind = ANY (ARRAY['PAID_OUTSIDE_BANK'::text, 'APPLY_CREDIT'::text, 'MISSING_INVOICES'::text, 'DUPLICATE_PAYMENT'::text, 'STATEMENT_GAP'::text, 'UNLINKED_TRANSFER'::text, 'NOTE'::text])));
alter table "public"."ai_findings" add constraint "ai_findings_pkey" PRIMARY KEY (id);
alter table "public"."ai_findings" add constraint "ai_findings_severity_check" CHECK ((severity = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text])));
alter table "public"."ai_findings" add constraint "ai_findings_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'ACCEPTED'::text, 'DISMISSED'::text, 'SUPERSEDED'::text])));
alter table "public"."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY (id);
alter table "public"."bank_accounts" add constraint "bank_accounts_currency" CHECK ((char_length(currency) = 3));
alter table "public"."bank_accounts" add constraint "bank_accounts_pkey" PRIMARY KEY (id);
alter table "public"."bank_imports" add constraint "bank_imports_pkey" PRIMARY KEY (id);
alter table "public"."bank_rules" add constraint "bank_rules_pkey" PRIMARY KEY (id);
alter table "public"."bank_transactions" add constraint "bank_transactions_pkey" PRIMARY KEY (id);
alter table "public"."bank_transactions" add constraint "bank_tx_amount_non_negative" CHECK ((amount_minor >= 0));
alter table "public"."bank_transactions" add constraint "bank_tx_match_score_range" CHECK (((match_score IS NULL) OR ((match_score >= 0) AND (match_score <= 100))));
alter table "public"."branches" add constraint "branches_code_key" UNIQUE (code);
alter table "public"."branches" add constraint "branches_pkey" PRIMARY KEY (id);
alter table "public"."counterparties" add constraint "counterparties_pkey" PRIMARY KEY (id);
alter table "public"."counterparty_evidence" add constraint "counterparty_evidence_pkey" PRIMARY KEY (id);
alter table "public"."counterparty_evidence" add constraint "counterparty_evidence_positive" CHECK ((confirmations > 0));
alter table "public"."decision_history" add constraint "decision_history_pkey" PRIMARY KEY (id);
alter table "public"."documents" add constraint "documents_drive_file_id_unique" UNIQUE (drive_file_id);
alter table "public"."documents" add constraint "documents_pkey" PRIMARY KEY (id);
alter table "public"."expenses" add constraint "expenses_amount_positive" CHECK ((amount_minor > 0));
alter table "public"."expenses" add constraint "expenses_period_matches_date" CHECK ((period_month = SUBSTRING(occurred_on FROM 1 FOR 7)));
alter table "public"."expenses" add constraint "expenses_pkey" PRIMARY KEY (id);
alter table "public"."expenses" add constraint "expenses_source_has_reference" CHECK ((((source = 'BANK'::expense_source) AND (bank_transaction_id IS NOT NULL)) OR ((source = 'INVOICE'::expense_source) AND (invoice_id IS NOT NULL)) OR (source = 'MANUAL'::expense_source)));
alter table "public"."extraction_cache" add constraint "extraction_cache_pkey" PRIMARY KEY (sha256);
alter table "public"."invoice_lines" add constraint "invoice_lines_pkey" PRIMARY KEY (id);
alter table "public"."invoices" add constraint "invoices_document_id_unique" UNIQUE (document_id);
alter table "public"."invoices" add constraint "invoices_parts_non_negative" CHECK ((((subtotal_minor IS NULL) OR (subtotal_minor >= 0)) AND ((vat_minor IS NULL) OR (vat_minor >= 0))));
alter table "public"."invoices" add constraint "invoices_parts_sum_to_total" CHECK (((subtotal_minor IS NULL) OR (vat_minor IS NULL) OR (abs(((subtotal_minor + vat_minor) - total_minor)) <= 100)));
alter table "public"."invoices" add constraint "invoices_pkey" PRIMARY KEY (id);
alter table "public"."invoices" add constraint "invoices_total_positive" CHECK ((total_minor > 0));
alter table "public"."issues" add constraint "issues_pkey" PRIMARY KEY (id);
alter table "public"."month_closes" add constraint "month_closes_month_unique" UNIQUE (month);
alter table "public"."month_closes" add constraint "month_closes_pkey" PRIMARY KEY (id);
alter table "public"."payment_allocations" add constraint "payment_allocations_pkey" PRIMARY KEY (id);
alter table "public"."payment_allocations" add constraint "payment_allocations_positive" CHECK ((amount_minor > 0));
alter table "public"."payments" add constraint "payments_advance_is_declared" CHECK (((status <> 'ADVANCE'::payment_status) OR is_advance));
alter table "public"."payments" add constraint "payments_document_id_unique" UNIQUE (document_id);
alter table "public"."payments" add constraint "payments_fee_within_amount" CHECK (((fee_minor >= 0) AND (fee_minor <= amount_minor)));
alter table "public"."payments" add constraint "payments_pkey" PRIMARY KEY (id);
alter table "public"."payments" add constraint "payments_reversal_has_reason" CHECK (((reversed_at IS NULL) OR (COALESCE(btrim(reversal_reason), ''::text) <> ''::text)));
alter table "public"."payments" add constraint "payments_status_matches_marks" CHECK ((((status = 'REVERSED'::payment_status) = ((reversed_at IS NOT NULL) AND (voided_at IS NULL))) AND ((status = 'VOID'::payment_status) = (voided_at IS NOT NULL))));
alter table "public"."pos_products" add constraint "pos_products_pkey" PRIMARY KEY (id);
alter table "public"."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table "public"."rate_limits" add constraint "rate_limits_pkey" PRIMARY KEY (key, window_start);
alter table "public"."reconciliation_periods" add constraint "reconciliation_period_order" CHECK ((period_start <= period_end));
alter table "public"."reconciliation_periods" add constraint "reconciliation_periods_pkey" PRIMARY KEY (id);
alter table "public"."recurring_expenses" add constraint "recurring_expenses_pkey" PRIMARY KEY (id);
alter table "public"."refund_lines" add constraint "refund_lines_pkey" PRIMARY KEY (id);
alter table "public"."refund_lines" add constraint "refund_lines_positive" CHECK ((amount_minor > 0));
alter table "public"."refunds" add constraint "refunds_pkey" PRIMARY KEY (id);
alter table "public"."refunds" add constraint "refunds_positive" CHECK ((amount_minor > 0));
alter table "public"."sale_lines" add constraint "sale_lines_pkey" PRIMARY KEY (id);
alter table "public"."sale_payments" add constraint "sale_payments_pkey" PRIMARY KEY (id);
alter table "public"."sale_payments" add constraint "sale_payments_positive" CHECK ((amount_minor > 0));
alter table "public"."sales" add constraint "sales_pkey" PRIMARY KEY (id);
alter table "public"."sales_sources" add constraint "sales_sources_pkey" PRIMARY KEY (id);
alter table "public"."schema_migrations" add constraint "schema_migrations_pkey" PRIMARY KEY (name);
alter table "public"."sessions" add constraint "sessions_pkey" PRIMARY KEY (session_token);
alter table "public"."settlement_batches" add constraint "settlement_batches_pkey" PRIMARY KEY (id);
alter table "public"."statement_lines" add constraint "statement_lines_pkey" PRIMARY KEY (id);
alter table "public"."statements" add constraint "statements_balances_nonneg" CHECK ((((opening_balance_minor IS NULL) OR (opening_balance_minor >= 0)) AND ((closing_balance_minor IS NULL) OR (closing_balance_minor >= 0))));
alter table "public"."statements" add constraint "statements_document_id_unique" UNIQUE (document_id);
alter table "public"."statements" add constraint "statements_pkey" PRIMARY KEY (id);
alter table "public"."supplier_aliases" add constraint "supplier_aliases_pkey" PRIMARY KEY (id);
alter table "public"."supplier_products" add constraint "supplier_products_content_pair" CHECK (((content_unit IS NULL) = (content_quantity IS NULL)));
alter table "public"."supplier_products" add constraint "supplier_products_pack_positive" CHECK ((((pack_size IS NULL) OR (pack_size > (0)::numeric)) AND ((content_quantity IS NULL) OR (content_quantity > (0)::numeric))));
alter table "public"."supplier_products" add constraint "supplier_products_pkey" PRIMARY KEY (id);
alter table "public"."suppliers" add constraint "suppliers_pkey" PRIMARY KEY (id);
alter table "public"."suppliers" add constraint "suppliers_slug_unique" UNIQUE (slug);
alter table "public"."suppliers" add constraint "suppliers_vat_number_unique" UNIQUE (vat_number);
alter table "public"."users" add constraint "users_email_unique" UNIQUE (email);
alter table "public"."users" add constraint "users_pkey" PRIMARY KEY (id);
alter table "public"."verification_tokens" add constraint "verification_tokens_identifier_token_pk" PRIMARY KEY (identifier, token);
alter table "public"."accounts" add constraint "accounts_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table "public"."adjudications" add constraint "adjudications_bank_transaction_id_fkey" FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id) ON DELETE CASCADE;
alter table "public"."ai_findings" add constraint "ai_findings_decided_by_id_fkey" FOREIGN KEY (decided_by_id) REFERENCES users(id);
alter table "public"."ai_findings" add constraint "ai_findings_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
alter table "public"."audit_logs" add constraint "audit_logs_actor_id_users_id_fk" FOREIGN KEY (actor_id) REFERENCES users(id);
alter table "public"."bank_accounts" add constraint "bank_accounts_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."bank_imports" add constraint "bank_imports_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
alter table "public"."bank_imports" add constraint "bank_imports_imported_by_id_users_id_fk" FOREIGN KEY (imported_by_id) REFERENCES users(id);
alter table "public"."bank_rules" add constraint "bank_rules_created_by_id_users_id_fk" FOREIGN KEY (created_by_id) REFERENCES users(id);
alter table "public"."bank_rules" add constraint "bank_rules_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table "public"."bank_transactions" add constraint "bank_transactions_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
alter table "public"."bank_transactions" add constraint "bank_transactions_bank_import_id_bank_imports_id_fk" FOREIGN KEY (bank_import_id) REFERENCES bank_imports(id) ON DELETE CASCADE;
alter table "public"."bank_transactions" add constraint "bank_transactions_counterparty_id_fkey" FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL;
alter table "public"."bank_transactions" add constraint "bank_transactions_matched_payment_id_payments_id_fk" FOREIGN KEY (matched_payment_id) REFERENCES payments(id);
alter table "public"."bank_transactions" add constraint "bank_transactions_rule_id_bank_rules_id_fk" FOREIGN KEY (rule_id) REFERENCES bank_rules(id) ON DELETE SET NULL;
alter table "public"."bank_transactions" add constraint "bank_transactions_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."counterparties" add constraint "counterparties_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES users(id);
alter table "public"."counterparties" add constraint "counterparties_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table "public"."counterparty_evidence" add constraint "counterparty_evidence_confirmed_by_id_fkey" FOREIGN KEY (confirmed_by_id) REFERENCES users(id);
alter table "public"."counterparty_evidence" add constraint "counterparty_evidence_counterparty_id_fkey" FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE CASCADE;
alter table "public"."decision_history" add constraint "decision_history_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id);
alter table "public"."decision_history" add constraint "decision_history_bank_transaction_id_fkey" FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id) ON DELETE CASCADE;
alter table "public"."documents" add constraint "documents_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."documents" add constraint "documents_uploaded_by_id_users_id_fk" FOREIGN KEY (uploaded_by_id) REFERENCES users(id);
alter table "public"."expenses" add constraint "expenses_bank_transaction_id_fkey" FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id) ON DELETE SET NULL;
alter table "public"."expenses" add constraint "expenses_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."expenses" add constraint "expenses_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES users(id);
alter table "public"."expenses" add constraint "expenses_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table "public"."expenses" add constraint "expenses_recurring_expense_id_fkey" FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id) ON DELETE SET NULL;
alter table "public"."extraction_cache" add constraint "extraction_cache_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
alter table "public"."invoice_lines" add constraint "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table "public"."invoice_lines" add constraint "invoice_lines_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."invoice_lines" add constraint "invoice_lines_supplier_product_id_fkey" FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id) ON DELETE SET NULL;
alter table "public"."invoices" add constraint "invoices_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."invoices" add constraint "invoices_document_id_documents_id_fk" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table "public"."invoices" add constraint "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."issues" add constraint "issues_resolved_by_id_users_id_fk" FOREIGN KEY (resolved_by_id) REFERENCES users(id);
alter table "public"."month_closes" add constraint "month_closes_closed_by_id_users_id_fk" FOREIGN KEY (closed_by_id) REFERENCES users(id);
alter table "public"."payment_allocations" add constraint "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table "public"."payment_allocations" add constraint "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;
alter table "public"."payments" add constraint "payments_document_id_documents_id_fk" FOREIGN KEY (document_id) REFERENCES documents(id);
alter table "public"."payments" add constraint "payments_reversed_by_id_fkey" FOREIGN KEY (reversed_by_id) REFERENCES users(id);
alter table "public"."payments" add constraint "payments_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."pos_products" add constraint "pos_products_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."pos_products" add constraint "pos_products_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table "public"."pos_products" add constraint "pos_products_source_id_fkey" FOREIGN KEY (source_id) REFERENCES sales_sources(id) ON DELETE CASCADE;
alter table "public"."reconciliation_periods" add constraint "reconciliation_periods_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE;
alter table "public"."reconciliation_periods" add constraint "reconciliation_periods_reviewed_by_id_fkey" FOREIGN KEY (reviewed_by_id) REFERENCES users(id);
alter table "public"."recurring_expenses" add constraint "recurring_expenses_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES users(id);
alter table "public"."refund_lines" add constraint "refund_lines_pos_product_id_fkey" FOREIGN KEY (pos_product_id) REFERENCES pos_products(id) ON DELETE SET NULL;
alter table "public"."refund_lines" add constraint "refund_lines_refund_id_fkey" FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE;
alter table "public"."refunds" add constraint "refunds_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."refunds" add constraint "refunds_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
alter table "public"."refunds" add constraint "refunds_source_id_fkey" FOREIGN KEY (source_id) REFERENCES sales_sources(id) ON DELETE CASCADE;
alter table "public"."sale_lines" add constraint "sale_lines_pos_product_id_fkey" FOREIGN KEY (pos_product_id) REFERENCES pos_products(id) ON DELETE SET NULL;
alter table "public"."sale_lines" add constraint "sale_lines_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
alter table "public"."sale_payments" add constraint "sale_payments_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
alter table "public"."sales" add constraint "sales_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."sales" add constraint "sales_source_id_fkey" FOREIGN KEY (source_id) REFERENCES sales_sources(id) ON DELETE CASCADE;
alter table "public"."sessions" add constraint "sessions_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table "public"."settlement_batches" add constraint "settlement_batches_bank_transaction_id_fkey" FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id) ON DELETE SET NULL;
alter table "public"."settlement_batches" add constraint "settlement_batches_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
alter table "public"."settlement_batches" add constraint "settlement_batches_source_id_fkey" FOREIGN KEY (source_id) REFERENCES sales_sources(id) ON DELETE SET NULL;
alter table "public"."statement_lines" add constraint "statement_lines_matched_invoice_id_invoices_id_fk" FOREIGN KEY (matched_invoice_id) REFERENCES invoices(id);
alter table "public"."statement_lines" add constraint "statement_lines_statement_id_statements_id_fk" FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE;
alter table "public"."statements" add constraint "statements_document_id_documents_id_fk" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table "public"."statements" add constraint "statements_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
alter table "public"."supplier_aliases" add constraint "supplier_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
alter table "public"."supplier_products" add constraint "supplier_products_confirmed_by_id_fkey" FOREIGN KEY (confirmed_by_id) REFERENCES users(id);
alter table "public"."supplier_products" add constraint "supplier_products_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table "public"."supplier_products" add constraint "supplier_products_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
CREATE INDEX accounts_user_idx ON public.accounts USING btree (user_id);
CREATE INDEX adjudications_at_idx ON public.adjudications USING btree (created_at DESC);
CREATE INDEX adjudications_tx_idx ON public.adjudications USING btree (bank_transaction_id);
CREATE INDEX ai_findings_status_created_idx ON public.ai_findings USING btree (status, created_at);
CREATE INDEX ai_findings_supplier_status_idx ON public.ai_findings USING btree (supplier_id, status);
CREATE INDEX audit_at_idx ON public.audit_logs USING btree (at);
CREATE INDEX audit_entity_idx ON public.audit_logs USING btree (entity_type, entity_id);
CREATE UNIQUE INDEX bank_accounts_number_uniq ON public.bank_accounts USING btree (account_number);
CREATE INDEX bank_imports_account_idx ON public.bank_imports USING btree (bank_account_id);
CREATE UNIQUE INDEX bank_imports_file_sha_uniq ON public.bank_imports USING btree (file_sha256);
CREATE UNIQUE INDEX bank_rule_normalized_uniq ON public.bank_rules USING btree (normalized);
CREATE INDEX bank_rules_category_idx ON public.bank_rules USING btree (category);
CREATE INDEX bank_tx_account_idx ON public.bank_transactions USING btree (bank_account_id);
CREATE INDEX bank_tx_category_idx ON public.bank_transactions USING btree (category);
CREATE INDEX bank_tx_classification_source_idx ON public.bank_transactions USING btree (classification_source) WHERE (classification_source IS NOT NULL);
CREATE INDEX bank_tx_counterparty_idx ON public.bank_transactions USING btree (counterparty_id) WHERE (counterparty_id IS NOT NULL);
CREATE INDEX bank_tx_date_idx ON public.bank_transactions USING btree (value_date);
CREATE INDEX bank_tx_disposition_idx ON public.bank_transactions USING btree (match_disposition) WHERE (match_disposition IS NOT NULL);
CREATE UNIQUE INDEX bank_tx_identity_uniq ON public.bank_transactions USING btree (identity_key) WHERE (identity_key IS NOT NULL);
CREATE INDEX bank_tx_import_idx ON public.bank_transactions USING btree (bank_import_id);
CREATE INDEX bank_tx_lifecycle_idx ON public.bank_transactions USING btree (lifecycle);
CREATE INDEX bank_tx_matched_payment_idx ON public.bank_transactions USING btree (matched_payment_id);
CREATE UNIQUE INDEX bank_tx_operation_ref_uniq ON public.bank_transactions USING btree (COALESCE(bank_account_id, '~'::text), operation_ref) WHERE (operation_ref IS NOT NULL);
CREATE INDEX bank_tx_period_idx ON public.bank_transactions USING btree (COALESCE(bank_account_id, '~'::text), value_date);
CREATE UNIQUE INDEX bank_tx_scoped_external_uniq ON public.bank_transactions USING btree (COALESCE(bank_account_id, '~'::text), external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX bank_tx_status_idx ON public.bank_transactions USING btree (match_status);
CREATE INDEX bank_tx_supplier_idx ON public.bank_transactions USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);
CREATE INDEX bank_tx_type_idx ON public.bank_transactions USING btree (transaction_type);
CREATE UNIQUE INDEX branches_single_default ON public.branches USING btree (is_default) WHERE is_default;
CREATE INDEX counterparties_supplier_idx ON public.counterparties USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);
CREATE UNIQUE INDEX counterparty_evidence_exclusive_uniq ON public.counterparty_evidence USING btree (kind, normalized) WHERE (kind = ANY (ARRAY['ACCOUNT'::counterparty_evidence_kind, 'IBAN'::counterparty_evidence_kind, 'NATIONAL_ID'::counterparty_evidence_kind, 'MERCHANT_ID'::counterparty_evidence_kind]));
CREATE INDEX counterparty_evidence_lookup_idx ON public.counterparty_evidence USING btree (kind, normalized);
CREATE INDEX counterparty_evidence_party_idx ON public.counterparty_evidence USING btree (counterparty_id);
CREATE UNIQUE INDEX counterparty_evidence_party_uniq ON public.counterparty_evidence USING btree (counterparty_id, kind, normalized);
CREATE INDEX decision_history_tx_idx ON public.decision_history USING btree (bank_transaction_id, created_at);
CREATE INDEX documents_period_supplier_idx ON public.documents USING btree (period_month, supplier_id);
CREATE UNIQUE INDEX documents_sha_uniq ON public.documents USING btree (sha256) WHERE (status <> 'REJECTED'::document_status);
CREATE INDEX documents_status_idx ON public.documents USING btree (status);
CREATE UNIQUE INDEX expenses_bank_tx_uniq ON public.expenses USING btree (bank_transaction_id) WHERE (bank_transaction_id IS NOT NULL);
CREATE INDEX expenses_branch_idx ON public.expenses USING btree (branch_id);
CREATE INDEX expenses_category_idx ON public.expenses USING btree (category);
CREATE INDEX expenses_event_idx ON public.expenses USING btree (event_key);
CREATE UNIQUE INDEX expenses_invoice_uniq ON public.expenses USING btree (invoice_id) WHERE (invoice_id IS NOT NULL);
CREATE INDEX expenses_period_idx ON public.expenses USING btree (period_month);
CREATE INDEX expenses_recurring_idx ON public.expenses USING btree (recurring_expense_id);
CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines USING btree (invoice_id);
CREATE INDEX invoice_lines_item_date_idx ON public.invoice_lines USING btree (normalized_description, invoice_date);
CREATE INDEX invoice_lines_item_idx ON public.invoice_lines USING btree (normalized_description);
CREATE INDEX invoice_lines_supplier_product_idx ON public.invoice_lines USING btree (supplier_product_id);
CREATE UNIQUE INDEX invoice_supplier_number_uniq ON public.invoices USING btree (supplier_id, invoice_number);
CREATE INDEX invoices_branch_idx ON public.invoices USING btree (branch_id);
CREATE INDEX invoices_date_idx ON public.invoices USING btree (invoice_date);
CREATE INDEX invoices_period_idx ON public.invoices USING btree (period_month);
CREATE INDEX invoices_posted_idx ON public.invoices USING btree (posted_to_accounting);
CREATE INDEX invoices_tax_status_idx ON public.invoices USING btree (tax_status);
CREATE INDEX issues_code_idx ON public.issues USING btree (code);
CREATE INDEX issues_entity_idx ON public.issues USING btree (entity_type, entity_id);
CREATE INDEX issues_status_severity_idx ON public.issues USING btree (status, severity);
CREATE UNIQUE INDEX payment_allocation_uniq ON public.payment_allocations USING btree (payment_id, invoice_id);
CREATE INDEX payment_allocations_invoice_idx ON public.payment_allocations USING btree (invoice_id);
CREATE INDEX payments_applies_month_idx ON public.payments USING btree (applies_to_month);
CREATE INDEX payments_status_idx ON public.payments USING btree (status);
CREATE INDEX payments_supplier_date_idx ON public.payments USING btree (supplier_id, paid_at);
CREATE UNIQUE INDEX pos_products_uniq ON public.pos_products USING btree (source_id, external_id);
CREATE INDEX products_category_idx ON public.products USING btree (category);
CREATE UNIQUE INDEX products_name_uniq ON public.products USING btree (name_ar) WHERE is_active;
CREATE INDEX rate_limits_window_idx ON public.rate_limits USING btree (window_start);
CREATE UNIQUE INDEX reconciliation_period_uniq ON public.reconciliation_periods USING btree (bank_account_id, period_start, period_end);
CREATE INDEX recurring_expenses_active_idx ON public.recurring_expenses USING btree (is_active);
CREATE INDEX refund_lines_refund_idx ON public.refund_lines USING btree (refund_id);
CREATE INDEX refunds_date_idx ON public.refunds USING btree (business_date);
CREATE UNIQUE INDEX refunds_external_uniq ON public.refunds USING btree (source_id, external_id);
CREATE UNIQUE INDEX sale_lines_external_uniq ON public.sale_lines USING btree (sale_id, external_id);
CREATE INDEX sale_lines_sale_idx ON public.sale_lines USING btree (sale_id);
CREATE UNIQUE INDEX sale_payments_external_uniq ON public.sale_payments USING btree (sale_id, method, external_id);
CREATE INDEX sale_payments_method_idx ON public.sale_payments USING btree (method);
CREATE INDEX sale_payments_sale_idx ON public.sale_payments USING btree (sale_id);
CREATE INDEX sales_branch_idx ON public.sales USING btree (branch_id);
CREATE INDEX sales_date_idx ON public.sales USING btree (business_date);
CREATE UNIQUE INDEX sales_uniq ON public.sales USING btree (source_id, external_id);
CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);
CREATE INDEX settlement_bank_idx ON public.settlement_batches USING btree (bank_transaction_id) WHERE (bank_transaction_id IS NOT NULL);
CREATE UNIQUE INDEX settlement_batch_uniq ON public.settlement_batches USING btree (merchant_id, batch_date, scheme) WHERE (merchant_id IS NOT NULL);
CREATE UNIQUE INDEX settlement_external_uniq ON public.settlement_batches USING btree (source_id, external_id);
CREATE INDEX statement_lines_statement_idx ON public.statement_lines USING btree (statement_id);
CREATE INDEX statement_lines_status_idx ON public.statement_lines USING btree (match_status);
CREATE INDEX statements_supplier_end_idx ON public.statements USING btree (supplier_id, period_end);
CREATE INDEX supplier_alias_normalized_idx ON public.supplier_aliases USING btree (normalized);
CREATE UNIQUE INDEX supplier_alias_uniq ON public.supplier_aliases USING btree (supplier_id, normalized, kind);
CREATE INDEX supplier_products_product_idx ON public.supplier_products USING btree (product_id);
CREATE UNIQUE INDEX supplier_products_uniq ON public.supplier_products USING btree (supplier_id, normalized_description);
CREATE INDEX suppliers_active_idx ON public.suppliers USING btree (is_active);
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_are_append_only();
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();
CREATE TRIGGER invoices_month_lock BEFORE INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION reject_closed_month_invoice();
CREATE CONSTRAINT TRIGGER payment_allocations_bounds AFTER INSERT OR UPDATE ON public.payment_allocations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION assert_allocation_within_bounds();
CREATE TRIGGER payment_allocations_month_lock BEFORE INSERT OR DELETE OR UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION reject_closed_month_allocation();
CREATE TRIGGER payments_month_lock BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION reject_closed_month_payment();

insert into "public"."schema_migrations" (name, sha256) values
  ('001_audit_log_immutable.sql', '07d4b653f188b6d016b340041833744a2c13ff43bb6981a5b01b24922be1d171'),
  ('002_tax_status_and_idempotency.sql', 'dfff7ce8f806c096d422ba7ec6a8594fc7a017d8210185e0d1c5768b70ddcb5b'),
  ('003_transaction_type.sql', '2f86d8d4df64ea1826fc1918ddea0cba5bca1e3c318cb1978bf796b440ad0bd0'),
  ('004_rate_limits.sql', '248acff9b64e0bfe3b4220a46c37514af9b1de9f72489d678708f875e0b2d897'),
  ('005_products_and_sales_domain.sql', '7bfe660d05bee5547e1b2316124acead81cd8c959748d139dbe4469683df948c'),
  ('006_expenses.sql', '53f6c3a24221dd1b1a782cd078e62b59c1550ef8dd5165b204a6f24f3d502787'),
  ('007_financial_invariants.sql', '6d14effb326dbf05883a75b4330c4cf2e8d4b812eef296817734e851ec45bcf5'),
  ('008_bank_kinds.sql', 'f002636ebe3593ff54e042dccae2a2a59738812ee159c078901292c3f84e8237'),
  ('009_match_evidence.sql', '8b1ce4ff25f1da20d56977858c086f8a6fcaf1686c5f0e0dfeadb52427a0ad6e'),
  ('010_counterparties.sql', 'a4f80be3a9e12491a53a8db6b1e657e399a661690477354345029dba4e8c0b70'),
  ('011_branches_and_accounts.sql', '30c9bc8c55e9d1b8f0a5a1b56b73df354765923cf8f5e885bcc08f25f4c78db0'),
  ('012_sales_domain.sql', 'e12546d660eb71823790de95f3497dc4bd29f231b2daaadfe1b491340d05ab71'),
  ('013_decision_provenance.sql', '9b5825c21fdaef2d6c146c3b3504b94c45aab8f875a269ab98cb81a959deb7b8'),
  ('014_identity_scoping.sql', 'f69a9ecb7ec5ff94e3c695601973dc96e016c6d3c166d9030eb96b85ee714093'),
  ('015_payment_lifecycle.sql', '7a4ce7e8df5d912ccd6472694ca55c5ae11e8885f10c9d6033a211eb65c865c0'),
  ('016_lifecycle_and_expense_events.sql', '51013939542609efa2cef1c18506f50e5d599326f33dc7c807e7eff9677574dd'),
  ('017_sales_identity_and_units.sql', '2035cfdc4b01169d7117edc0918ca3fbac7422732e83591ba997b4d0794c2668'),
  ('018_statement_balances_nullable.sql', '8a7a22b27fafd6de4106a60902353d1bfe1ac38e4bfa552ce3f4e0fffbd65254'),
  ('019_pattern_identity.sql', '70b4b279fda602fb1ab1c54ddc0a00e502f855e7038b1d367723158811fcf9fb'),
  ('020_natural_transaction_key.sql', 'd7fe6bd9638d76a4f533532a830abec71ac3abf6e450b53e550c32cd8164dc09'),
  ('021_amount_classification.sql', '8668c4ef44096cf7120dae8049532aad53aa6c7fb5629680ea2eef92e2d34e43'),
  ('022_bank_vat_category.sql', '07daa8d430b2c73e5c9f6ff80a023e4c4143d5c08b7d5474df3ccfb235f61488'),
  ('023_operation_reference.sql', 'f201d3f48b545f95d44033504fd1381881800d73796a62cc4fb6b8af5c64dc11'),
  ('024_identity_key.sql', 'cbf0a3c560196832869ee672c3d13f5621443f3a66e69656c975a57862427633'),
  ('025_identity_supersedes_natural.sql', 'de30a82f1c373a8975d366a446dd120e5209be463d242ce06261793a6c2967ac'),
  ('026_allocation_bounds_serialize.sql', '4bf5974be1299885ce080972ef89c9d76ab97dfda11b13fc86a9381dacc670db'),
  ('027_owner_account_and_ai_findings.sql', 'd0f6c5f63b0a2069e51926557d1b21fc90ce651d160ac737af8c8a4c2f5415ad'),
  ('028_month_lock.sql', '0be5da18f163b0140d82c108b2b14cbcc326b3b5acc0fcf7e76278595ee8c56b'),
  ('029_ops_indexes.sql', 'aae04f2fe5557e9befe3d37fd8b77e856862449b5d2f3b7fa1d3ae69b2c7ae62'),
  ('030_extraction_cache.sql', '7ce830252e294dbbd3fff7db9b11a0c4f0450168ba935e1fb83c0f5886c82209'),
  ('031_extraction_text_source.sql', 'f14a932733594a0aa7e5537111c23fe41955b75f24cb979e907fcead7d753a06');
