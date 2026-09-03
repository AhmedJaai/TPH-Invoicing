# دليل التشغيل خطوة بخطوة

كل ما يلزم لتشغيل النظام فعلياً، مرتّباً بالترتيب الذي يجب أن تنفّذه.
الوقت الإجمالي المتوقّع: نحو ثلاثين دقيقة.

---

## الخطوة ١ — بيانات جوجل (إلزامية)

> جوجل غيّرت هذه الواجهة في ٢٠٢٦ إلى «Google Auth Platform»، وقسّمت ما كان
> صفحة واحدة إلى أربعة أقسام. الخطوات أدناه للواجهة الجديدة.

**لا تبدأ تجربة الـ٣٠٠ دولار** — لا نحتاج فوترة، وهي تطلب بطاقة بلا داعٍ.

### ١-أ · أنشئ مشروعاً وفعّل واجهة الدرايف

1. [console.cloud.google.com](https://console.cloud.google.com) ← **New Project** ← `TPH Invoicing`.
2. **APIs & Services ← Library** ← ابحث `Google Drive API` ← **Enable**.

بدون الخطوة الثانية يفشل الرفع لاحقاً بخطأ غامض.

### ١-ب · Google Auth Platform

من القائمة الجانبية افتح **Google Auth Platform**، ثم نفّذ الأقسام بالترتيب:

| القسم | ما تضبطه |
|---|---|
| **Branding** | اسم التطبيق `TPH Invoicing` بالإنجليزية (الأسماء غير اللاتينية تُبطئ التدقيق) · بريد الدعم · بريد المطوّر |
| **Audience** | **External** · أضف نفسك ومن سيستخدم النظام في **Test users** |
| **Data access** | **Add or remove scopes** ← أضف `https://www.googleapis.com/auth/drive` ومعه `openid` و `email` و `profile` |
| **Clients** | **Create OAuth client** ← **Web application** |

سيحذّرك جوجل أنّ نطاق `drive` **مقيَّد**. هذا متوقّع، ويعمل لمستخدمي الاختبار
بلا توثيق.

### ١-ج · عناوين الرجوع

في العميل الجديد أضف الثلاثة **حرفياً**:

```
https://tph-invoicing.vercel.app/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
http://127.0.0.1:53682/callback
```

الأول للموقع الحيّ، والثاني للتطوير، والثالث لأداة جرد الدرايف. أيّ حرف زائد
يعطي `redirect_uri_mismatch`.

انسخ **Client ID** و **Client Secret** إلى `.env`.

### ١-د · النشر لإنهاء انتهاء الجلسة

ما دام التطبيق في وضع **Testing** تنتهي الجلسة كل سبعة أيام. حين ترضى عنه ارجع
إلى **Audience** واضغط **Publish app**. ستظهر شاشة «لم توثّق جوجل هذا التطبيق»
يتجاوزها كل مستخدم مرة واحدة بـ **Advanced ← Continue**. السقف مئة مستخدم.

---

## الخطوة ٢ — قائمة الدخول البيضاء

لا أحد يدخل النظام ما لم يكن هنا. في `.env`:

```
ALLOWED_EMAILS="ahmedaljaaidi98@gmail.com:OWNER,acc@example.com:ACCOUNTANT,buy@example.com:PURCHASING"
```

| الدور | يرى | لا يرى |
|---|---|---|
| `OWNER` | كل شيء | — |
| `ACCOUNTANT` | كل المالية والتقارير والبنك | إدارة المستخدمين · الرواتب |
| `PURCHASING` | الرفع والمتابعة والموردين | أي رقم مالي · البنك · الرواتب · التقارير |

الدور يُثبَّت عند أول دخول للمستخدم. تغييره بعد ذلك من داخل النظام.

---

## الخطوة ٣ — قارئ الفواتير

اختر واحداً واضبط `EXTRACTION_PROVIDER`:

| القيمة | الكلفة | الخصوصية | الدقة |
|---|---|---|---|
| `claude` | ~١٠ هللات للفاتورة | بياناتك ليست مادة تدريب | الأعلى |
| `gemini` | مجاني (١٥٠٠ طلب يومياً) | ⚠ جوجل تستخدم بيانات الطبقة المجانية لتحسين منتجاتها وقد يراجعها بشر | عالية |
| `ollama` | مجاني تماماً | لا يخرج شيء من جهازك | الأدنى |

**لجيميني:** المفتاح مجاناً من [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY`.

**لكلود:** المفتاح من [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`.

**للمحلي:**
```bash
brew install ollama && ollama serve
ollama pull qwen2.5vl:7b
```
ثم `EXTRACTION_PROVIDER=ollama`. يقرأ الصور فقط لا ملفات PDF، ويحتاج جهازك مشتغلاً.

---

## الخطوة ٤ — التشغيل

```bash
npm install
npm run db:push      # ينشئ الجداول
npm run db:seed      # يؤسّس سجل الموردين
npm run dev          # http://localhost:3000
```

---

## الخطوة ٥ — ترحيل الأرشيف القائم

يقرأ مستنداتك في الدرايف ويسجّلها في قاعدة البيانات، **دون أن يعدّل أو ينقل
أو يعيد تسمية أي ملف**.

```bash
npm run drive:auth            # صلاحية قراءة فقط
npm run drive:inventory       # جرد ومعاينة
npm run drive:migrate         # معاينة الترحيل بلا كتابة
npm run drive:migrate -- --commit   # الكتابة فعلاً
```

الترحيل يستخلص أيضاً أسماء المستفيدين البنكية من أسماء ملفات الإيصالات،
فيبني جدول الأسماء البديلة الذي تحتاجه مطابقة كشف البنك لاحقاً.

---

## الخطوة ٦ — النشر

### على Vercel (الحالي)

```bash
vercel deploy --prod
```

المتغيّرات مضبوطة على المشروع. لإضافة متغيّر جديد:
```bash
printf '%s' "القيمة" | vercel env add اسم_المتغير production --force
```

### على Firebase App Hosting (لاحقاً)

ملف `apphosting.yaml` جاهز. يتطلّب:

1. خطة **Blaze** — تطلب بطاقة ائتمانية حتى مع وجود طبقة مجانية.
2. `npm i -g firebase-tools && firebase login`
3. `firebase apphosting:backends:create --project <PROJECT_ID>` واربطه بمستودع
   `AhmedJaai/TPH-Invoicing`.
4. أنشئ الأسرار:
   ```bash
   firebase apphosting:secrets:set DATABASE_URL
   firebase apphosting:secrets:set AUTH_SECRET
   firebase apphosting:secrets:set GOOGLE_CLIENT_ID
   firebase apphosting:secrets:set GOOGLE_CLIENT_SECRET
   firebase apphosting:secrets:set ALLOWED_EMAILS
   firebase apphosting:secrets:set GEMINI_API_KEY
   ```
5. عدّل `AUTH_URL` في `apphosting.yaml` إلى نطاقك الجديد، وأضف عنوان الرجوع
   الجديد في بيانات جوجل (الخطوة ١-د).

---

## الأوامر كلها

| الأمر | ما يفعله |
|---|---|
| `npm run dev` | التشغيل للتطوير |
| `npm test` | ١١٢ اختباراً لمنطق الأعمال |
| `npm run typecheck` | فحص الأنواع |
| `npm run lint` | فحص الأسلوب |
| `npm run build` | البناء للإنتاج |
| `npm run db:push` | مزامنة المخطط |
| `npm run db:seed` | تأسيس الموردين (قابل للتكرار) |
| `npm run db:demo` | بيانات تجريبية لتجربة الصفحات التحليلية |
| `npm run db:demo -- --clear` | حذف البيانات التجريبية وحدها |
| `npm run db:studio` | متصفح بيانات رسومي |
| `npm run drive:auth` | مفتاح الدرايف — قراءة فقط |
| `npm run drive:auth -- --write` | مفتاح بصلاحية الكتابة |
| `npm run drive:inventory` | جرد الأرشيف |
| `npm run drive:migrate` | ترحيل الأرشيف (أضف `--commit` للكتابة) |

---

## فحص الصحّة

قبل أن تبحث عن العطل، اسأل النظام عن نفسه:

```
https://tph-invoicing.vercel.app/api/health
```

يخبرك أيّ جزء لا يعمل: قاعدة البيانات وزمن استجابتها، ونوع نقطة الاتصال
(يجب أن تكون **مجمَّعة**)، وقارئ الفواتير ووجود مفتاحه، وبيانات جوجل،
وعدد من في القائمة البيضاء، وهل وضع التجربة مفعّل. ولا يكشف قيمة أي سرّ.

## حين لا يعمل شيء

| العرَض | السبب الغالب |
|---|---|
| «هذا البريد غير مصرَّح له» | البريد ليس في `ALLOWED_EMAILS` |
| «لا يوجد تفويض درايف لحسابك» | سجّل خروجاً ثم دخولاً ووافق على صلاحية الدرايف |
| انتهاء الجلسة كل سبعة أيام | التطبيق ما زال في وضع Testing — انشره (الخطوة ١-ج) |
| «مفتاح ANTHROPIC_API_KEY غير مضبوط» | اضبط المفتاح أو بدّل `EXTRACTION_PROVIDER` |
| «تجاوزنا حدّ الطبقة المجانية» | حدّ جيميني ١٥ طلباً في الدقيقة — انتظر قليلاً |
| `redirect_uri_mismatch` | العنوان غير مضاف في بيانات اعتماد جوجل (الخطوة ١-د) |
| زرّ الرفع يبقى «يرفع…» بلا نهاية | نقطة اتصال قاعدة البيانات مباشرة لا مجمَّعة — افحص `/api/health` |
| «تأخّر الخادم أكثر من دقيقتين» | الطلب تجاوز مهلته. تحقّق من الدرايف قبل إعادة المحاولة تفادياً للتكرار |

---

## وضع التجربة

`AUTH_BYPASS=true` يتخطّى تسجيل الدخول ويعطي صلاحية المالك. للتجربة وحدها:
متى كان مفعّلاً فكل من يعرف الرابط يدخل، ويظهر شريط أصفر في كل صفحة ينبّه على
ذلك. أطفئه بـ `AUTH_BYPASS=false` ثم أعد النشر.
