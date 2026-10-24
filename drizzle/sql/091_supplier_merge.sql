-- 091 — دمجُ المورّد بيد صاحبه: المدموجُ يبقى شاهداً معطَّلاً، والدمجُ يُتراجَع عنه.
-- إضافةٌ وحدها: أعمدةٌ تقبل الفراغ في `suppliers`، وجدولٌ جديد لسجلّ الدمج يُتراجَع به.
-- الصفُّ المدموج يبقى شاهداً (معطَّلاً، `merged_into_id`) لا يُحذف، فلا تُكسر إشارةٌ إليه.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merged_into_id text REFERENCES suppliers(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merged_by_id text REFERENCES users(id);

CREATE TABLE IF NOT EXISTS supplier_merges (
  id            text PRIMARY KEY,
  source_id     text NOT NULL REFERENCES suppliers(id),
  target_id     text NOT NULL REFERENCES suppliers(id),
  moved         jsonb NOT NULL,
  removed       jsonb NOT NULL,
  copied        jsonb NOT NULL,
  merged_by_id  text REFERENCES users(id),
  merged_at     timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by_id  text REFERENCES users(id),
  CONSTRAINT supplier_merges_distinct CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS supplier_merges_source_idx ON supplier_merges (source_id);
CREATE INDEX IF NOT EXISTS supplier_merges_target_idx ON supplier_merges (target_id);
