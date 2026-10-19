-- 081 — صورُ الفريق: الباريستا يصوّر الفاتورة الورقيّة من رابطه، وصاحبُ العمل يعتمدها.
--
--   capture_links — رابطٌ شخصيّ لكلّ موظّف بلا دخول. تُحفظ بصمةُ رمزه لا الرمز، ويُلغى
--     ولا يُحذف (`revoked_at`) فيبقى اسمُ من أرسل ما أرسله.
--   captures — الصورةُ كما وصلت، تنتظر في القاعدة لا في الدرايف: الأرشيفُ لا يُمسّ قبل
--     إقرار إنسان. تُعتمد بالأرشفة المعتادة (`/api/archive`) فتصير مستنداً ويُفرَّغ ملفُّها،
--     أو تُرفض بسببها ويراه مرسلُها.
--
-- إضافةٌ خالصة: لا مال هنا، ولا يُنشأ من الصورة شيءٌ قبل الأرشفة.

create table if not exists capture_links (
  id             text primary key,
  label          text not null check (length(btrim(label)) between 1 and 60),
  token_hash     text not null unique,
  created_by_id  text references users(id),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_by_id  text references users(id)
);

create table if not exists captures (
  id                 text primary key,
  link_id            text not null references capture_links(id),
  file_data          bytea,
  mime_type          text not null,
  size_bytes         integer not null check (size_bytes > 0),
  sha256             text not null,
  original_file_name text,
  note               text check (note is null or length(note) <= 300),
  status             text not null default 'PENDING' check (status in ('PENDING', 'ARCHIVED', 'REJECTED')),
  -- قراءةُ الذكاء فور الوصول: تُحفظ في extraction_cache بالبصمة، وهنا متى وما تعثّر
  read_at            timestamptz,
  read_error         text,
  document_id        text references documents(id) on delete set null,
  decided_by_id      text references users(id),
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now(),
  -- ما ينتظر لا بدّ له من ملفّ؛ والمرفوضُ يُقال سببُه لمرسله
  check (status <> 'PENDING' or file_data is not null),
  check (status <> 'REJECTED' or (decision_note is not null and length(btrim(decision_note)) > 0)),
  check (status = 'PENDING' or decided_at is not null)
);
-- الصورةُ نفسُها لا تنتظر مرّتين (ضغطتان · إعادةُ إرسالٍ بعد انقطاع)؛ والمرفوضةُ تُرسَل ثانيةً
create unique index if not exists captures_sha_live_idx on captures (sha256) where status <> 'REJECTED';
create index if not exists captures_pending_idx on captures (created_at) where status = 'PENDING';
create index if not exists captures_link_idx on captures (link_id, created_at desc);
