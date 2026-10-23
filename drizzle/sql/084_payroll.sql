-- 084 — الموظّفون والرواتب والحضور.
--
-- أحمد (٢٣ أكتوبر ٢٠٢٦): «صفحة موارد بشرية… كم راتب كل موظف وأقدر أعدّل (مايو ٣٠٠٠، سبتمبر ٣٥٠٠)…
-- مسيّر رواتب بخانات خصم وسلفة ومخالفة بلدية وتأخير… ويعطيني كم لازم أحوّل… وأربط الحوالات
-- البنكيّة بالراتب، وبعضها من الحوالات اللي أحوّلها لنفسي… بارت تايم أحوّلهم أسبوعياً… حاسبة
-- خصومات التأخير… ومو كل شيء راح للوليد راتب، بعضه يسدّد فاتورة… ورابط حضور مربوط بموقع الكافيه».
--
-- المسيّرُ **يُحسَب ولا يُخزَّن**: الراتبُ من سجلّ الرواتب بشهره، والخصوماتُ والإضافاتُ بنود،
-- والتأخيرُ أيّامٌ تُجمع، وما حُوِّل حوالاتٌ مربوطة بغرضها. فلا «صافٍ» مكتوبٌ يخالف ما تحته.
--
-- وربطُ الحوالة بغرضها هو وحده ما يمسّ قائمةَ الدخل: ينقل مبلغاً من فئة الحوالة إلى فئة غرضها
-- (راتب · مصروف · شخصيّ) أو يُخرجه (سدادُ فاتورةٍ محسوبةٍ في المشتريات). فيحرسه إقفالُ الشهر.
--
-- إضافةٌ خالصة.

create table if not exists employees (
  id                  text primary key,
  name                text not null check (length(btrim(name)) between 2 and 120),
  -- شهريّ: راتبٌ كلَّ شهر · جزئيّ: أجرُ ساعةٍ يُحوَّل أسبوعيّاً
  kind                text not null check (kind in ('MONTHLY', 'PART_TIME')),
  job_title           text check (job_title is null or length(job_title) <= 60),
  phone               text check (phone is null or phone ~ '^\+?[0-9 ]{7,20}$'),
  national_id         text check (national_id is null or national_id ~ '^[0-9]{6,20}$'),
  -- رقمُ المستفيد كما يكتبه البنك («BEN ID:…») — به تُقترح حوالاتُه. الاسمُ ليس هويّة.
  bank_beneficiary_id text check (bank_beneficiary_id is null or bank_beneficiary_id ~ '^[0-9]{4,20}$'),
  iban                text check (iban is null or iban ~ '^SA[0-9]{22}$'),
  -- يومُ المباشرة ويومُ الخروج: الشهرُ الأوّل والأخير يُحسبان بأيّامهما
  hired_on            text not null check (hired_on ~ '^\d{4}-\d{2}-\d{2}$'),
  left_on             text check (left_on is null or left_on ~ '^\d{4}-\d{2}-\d{2}$'),
  -- الدوام: بدايتُه وطولُه ودقائقُ السماح وأيّامُ الراحة (٠ الأحد … ٦ السبت)
  shift_start         text check (shift_start is null or shift_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  shift_minutes       integer not null default 480 check (shift_minutes between 60 and 960),
  late_grace_minutes  integer not null default 0 check (late_grace_minutes between 0 and 120),
  days_off            text not null default '' check (days_off ~ '^[0-6]{0,7}$'),
  -- رابطُ الحضور الشخصيّ: تُحفظ بصمةُ رمزه لا الرمز
  checkin_token_hash  text unique,
  note                text,
  created_by_id       text references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (left_on is null or hired_on <= left_on)
);
create unique index if not exists employees_beneficiary_idx on employees (bank_beneficiary_id) where bank_beneficiary_id is not null;

-- الراتبُ يتغيّر بشهرٍ يبدأ منه: «في مايو ٣٠٠٠، ومن سبتمبر ٣٥٠٠».
-- للشهريّ راتبُ الشهر، وللجزئيّ أجرُ الساعة.
create table if not exists employee_rates (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  from_month    text not null check (from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_minor  integer not null check (amount_minor > 0),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  unique (employee_id, from_month)
);

-- ما على الموظّف وما له في شهر. المبلغُ موجبٌ دائماً واتّجاهُه من نوعه:
--   ينقص الراتب: DEDUCTION خصم · FINE مخالفة · ADVANCE سلفةٌ نقداً على راتب الشهر · LOAN_REPAYMENT قسطُ سلفة
--   يزيده: BONUS مكافأة · OVERTIME إضافيّ · ALLOWANCE بدل
--   خارج المسيّر: LOAN_GIVEN سلفةٌ نقداً تُسدَّد على أشهر (تدخل رصيدَ السلف وحده)
-- يُسحَب ولا يُحذَف.
create table if not exists payroll_adjustments (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  month         text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind          text not null check (kind in ('DEDUCTION', 'FINE', 'ADVANCE', 'LOAN_REPAYMENT', 'BONUS', 'OVERTIME', 'ALLOWANCE', 'LOAN_GIVEN')),
  amount_minor  integer not null check (amount_minor > 0),
  note          text check (note is null or length(note) <= 300),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by_id  text references users(id)
);
create index if not exists payroll_adjustments_month_idx on payroll_adjustments (month) where voided_at is null;
create index if not exists payroll_adjustments_employee_idx on payroll_adjustments (employee_id) where voided_at is null;

-- اليومُ بحاله: تأخيرٌ أو انصرافٌ مبكّر (بالدقائق، يُخصمان)، غيابٌ (يُخصم يوماً)، أو إجازة (لا تُخصم).
-- يُكتب بيد صاحب المقهى (MANUAL) أو يُحسب من تسجيل الحضور (CHECKIN) — واليدُ تغلب.
create table if not exists payroll_attendance (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  day           text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  kind          text not null check (kind in ('LATE', 'EARLY', 'ABSENT', 'LEAVE')),
  minutes       integer,
  source        text not null default 'MANUAL' check (source in ('MANUAL', 'CHECKIN')),
  note          text check (note is null or length(note) <= 300),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  check ((kind in ('LATE', 'EARLY')) = (minutes is not null)),
  check (minutes is null or minutes between 1 and 960)
);
create unique index if not exists payroll_attendance_day_idx on payroll_attendance (employee_id, day, kind) where voided_at is null;
create index if not exists payroll_attendance_day_only_idx on payroll_attendance (day) where voided_at is null;

-- أسبوعُ الجزئيّ: ساعاتُه (إن عُرفت) وأجرُه، ويُنسب إلى شهر سبته.
create table if not exists payroll_weeks (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  week_start    text not null check (week_start ~ '^\d{4}-\d{2}-\d{2}$'),
  minutes       integer check (minutes is null or minutes between 1 and 10080),
  amount_minor  integer not null check (amount_minor > 0),
  note          text check (note is null or length(note) <= 300),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz
);
create unique index if not exists payroll_weeks_week_idx on payroll_weeks (employee_id, week_start) where voided_at is null;

-- حوالةٌ (أو جزءٌ منها) لموظّفٍ بغرضها. حوالةٌ واحدة تُقسَم: تحويلُ المالك لنفسه على عدّة رواتب،
-- أو حوالةُ الوليد بين راتبٍ وسدادِ فاتورة.
--   SALARY راتبُ الشهر · ADVANCE سلفةٌ على راتب الشهر · LOAN سلفةٌ تُسدَّد على أشهر
--   INVOICE لسداد فاتورة مورّدٍ مقيَّدة (محسوبةٌ في المشتريات) · EXPENSE مصروفٌ للمقهى دفعه عنه
--   PERSONAL مالٌ شخصيّ لا شأن للمقهى به
create table if not exists payroll_links (
  id                  text primary key,
  employee_id         text not null references employees(id) on delete cascade,
  month               text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  purpose             text not null default 'SALARY' check (purpose in ('SALARY', 'ADVANCE', 'LOAN', 'INVOICE', 'EXPENSE', 'PERSONAL')),
  bank_transaction_id text not null references bank_transactions(id) on delete restrict,
  amount_minor        integer not null check (amount_minor > 0),
  note                text check (note is null or length(note) <= 300),
  created_by_id       text references users(id),
  created_at          timestamptz not null default now(),
  voided_at           timestamptz,
  voided_by_id        text references users(id)
);
create index if not exists payroll_links_tx_idx on payroll_links (bank_transaction_id) where voided_at is null;
create index if not exists payroll_links_month_idx on payroll_links (month) where voided_at is null;
create index if not exists payroll_links_employee_idx on payroll_links (employee_id) where voided_at is null;

-- الحوالةُ لا تُوزَّع بأكثر من مبلغها، ولا تكون إلّا خارجةً — راتباً أو تحويلاً للمالك.
-- وشهرُ الحوالة المقفل لا يُربط فيه ولا يُفكّ: الربطُ ينقل مبلغاً في قائمة دخله.
create or replace function payroll_link_guard() returns trigger as $$
declare
  tx record;
  used bigint;
begin
  if tg_op = 'UPDATE' then
    if new.voided_at is not null and old.voided_at is null
       and new.amount_minor = old.amount_minor and new.bank_transaction_id = old.bank_transaction_id
       and new.purpose = old.purpose and new.employee_id = old.employee_id and new.month = old.month then
      select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month into tx
        from bank_transactions where id = old.bank_transaction_id;
      if month_is_closed(tx.month) then
        raise exception 'شهر الحوالة % مقفل — أعِد فتحه قبل فكّ ربطها', tx.month using errcode = 'P0001';
      end if;
      return new;
    end if;
    raise exception 'ربطُ الحوالة لا يُعدَّل — فُكّه واربطه من جديد' using errcode = 'P0001';
  end if;

  -- قفلُ الحوالة: ربطان متزامنان لا يتجاوزان مبلغها معاً
  select id, amount_minor, direction::text as direction, category::text as category,
         to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month
    into tx from bank_transactions where id = new.bank_transaction_id for update;
  if tx.direction <> 'DEBIT' or tx.category not in ('SALARY', 'PERSONAL') then
    raise exception 'لا تُربط بموظفٍ إلّا حوالةٌ خارجة مصنّفة «راتب» أو «تحويل لحساب المالك»' using errcode = 'P0001';
  end if;
  if month_is_closed(tx.month) then
    raise exception 'شهر الحوالة % مقفل — أعِد فتحه قبل ربطها', tx.month using errcode = 'P0001';
  end if;
  select coalesce(sum(amount_minor), 0) into used
    from payroll_links where bank_transaction_id = new.bank_transaction_id and voided_at is null;
  if used + new.amount_minor > tx.amount_minor then
    raise exception 'ما وُزِّع من هذه الحوالة أكثر من مبلغها' using errcode = 'P0001';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists payroll_links_guard on payroll_links;
create trigger payroll_links_guard
  before insert or update on payroll_links
  for each row execute function payroll_link_guard();

-- الحضورُ من جوال الموظّف: الوقتُ وموقعُه وشبكتُه، والحكمُ عليه وقتَ التسجيل.
-- الإحداثيّاتُ أعدادٌ صحيحة بالميكرودرجة. لا يُحذَف.
create table if not exists attendance_checkins (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  kind          text not null check (kind in ('IN', 'OUT')),
  at            timestamptz not null default now(),
  -- يومُ الدوام الذي يُنسب إليه (الانصرافُ بعد منتصف الليل لدوام الأمس)
  day           text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  lat_micro     integer,
  lng_micro     integer,
  accuracy_m    integer,
  distance_m    integer,
  ip            text,
  -- IN_PLACE في المقهى · ON_NETWORK على شبكته · FAR بعيدٌ عنه · NO_LOCATION لم يُعطِ موقعه
  verdict       text not null check (verdict in ('IN_PLACE', 'ON_NETWORK', 'FAR', 'NO_LOCATION')),
  user_agent    text,
  -- قرارُ صاحب المقهى في تسجيلٍ مشكوك: قُبل أو رُفض
  review        text check (review in ('ACCEPTED', 'REJECTED')),
  reviewed_by_id text references users(id),
  reviewed_at   timestamptz,
  check ((lat_micro is null) = (lng_micro is null))
);
create index if not exists attendance_checkins_day_idx on attendance_checkins (day, employee_id);
create index if not exists attendance_checkins_employee_idx on attendance_checkins (employee_id, at desc);

-- وثائقُ الموظّف (إقامة · شهادة صحية) من متتبّع الانتهاء نفسه (074) — مربوطةً به لا باسمه.
alter table obligations add column if not exists employee_id text references employees(id) on delete set null;
create index if not exists obligations_employee_idx on obligations (employee_id) where employee_id is not null;
