/**
 * Read-only system legal templates (قالب عمومی قابل بررسی — نه تضمین برای همه پرونده‌ها).
 */
const DISCLAIMER =
  'این قالب صرفاً الگوی اولیه است؛ قبل از ارسال، با اطلاعات پرونده و مقررات حاکم تطبیق دهید.';

const SYSTEM_LEGAL_TEMPLATES = [
  {
    slug: 'petition-debt',
    category: 'petition',
    title: 'دادخواست مطالبه وجه',
    usageNotes: `${DISCLAIMER} مبلغ و مبنای مطالبه را دقیق وارد کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

دادخواست مطالبه وجه

خواهان: {{client_name}} — شماره ملی: {{client_national_id}}
وکیل: {{lawyer_name}} — تلفن: {{lawyer_phone}}
خوانده: {{opponent_name}}

خواسته: مطالبه مبلغ {{claim_amount}} ریال بابت [ذکر موضوع و مبنای قراردادی/قانونی]

شماره پرونده / مرجع: {{case_number}}
تاریخ: {{document_date}}

با احترام
{{lawyer_name}}`
  },
  {
    slug: 'petition-performance',
    category: 'petition',
    title: 'دادخواست الزام به انجام تعهد',
    usageNotes: `${DISCLAIMER} تعهد مورد نظر را شفاف بنویسید.`,
    body: `ریاست محترم دادگاه {{court_name}}

دادخواست الزام به انجام تعهد

خواهان: {{client_name}}
خوانده: {{opponent_name}}
موضوع: الزام خوانده به [شرح تعهد]

شماره پرونده: {{case_number}}
تاریخ: {{document_date}}

{{lawyer_name}}`
  },
  {
    slug: 'petition-mehr',
    category: 'petition',
    title: 'دادخواست مطالبه مهریه (وجه رایج)',
    usageNotes: `${DISCLAIMER} نوع مهریه و مبنای محاسبه را جداگانه بررسی کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

دادخواست مطالبه مهریه

خواهان: {{client_name}}
خوانده: {{opponent_name}}
خواسته: مطالبه مهریه به مبلغ {{claim_amount}} ریال [ذکر نحوه توافق]

تاریخ عقد: {{contract_date}}
تاریخ: {{document_date}}

{{lawyer_name}}`
  },
  {
    slug: 'pleading-defense',
    category: 'pleading',
    title: 'لایحه دفاعیه',
    usageNotes: `${DISCLAIMER} ادله و مستندات را ضمیمه کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

لایحه دفاعیه

وکیل: {{lawyer_name}}
موکل: {{client_name}}
شماره پرونده: {{case_number}}

خلاصه ادعا و دفاع:
[متن دفاع]

تاریخ: {{document_date}}

{{lawyer_name}}`
  },
  {
    slug: 'pleading-extension',
    category: 'pleading',
    title: 'لایحه درخواست مهلت',
    usageNotes: `${DISCLAIMER} علت و مدت مهلت را مشخص کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

درخواست مهلت

وکیل: {{lawyer_name}} — موکل: {{client_name}}
شماره پرونده: {{case_number}}

خواسته: اعطای مهلت به مدت […] روز برای [اقدام مورد نظر].

دلایل: […]

تاریخ: {{document_date}}`
  },
  {
    slug: 'pleading-expertise',
    category: 'pleading',
    title: 'لایحه درخواست کارشناسی',
    usageNotes: `${DISCLAIMER} موضوع کارشناسی را دقیق تعیین کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

درخواست ارجاع به کارشناسی

موکل: {{client_name}} — پرونده: {{case_number}}
موضوع کارشناسی: […]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'pleading-expert-objection',
    category: 'pleading',
    title: 'لایحه اعتراض به نظریه کارشناسی',
    usageNotes: `${DISCLAIMER} ایرادات فنی و حقوقی را جدا بنویسید.`,
    body: `ریاست محترم دادگاه {{court_name}}

اعتراض به نظریه کارشناسی

پرونده: {{case_number}} — موکل: {{client_name}}

ایرادات:
1. […]
2. […]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'pleading-appeal',
    category: 'pleading',
    title: 'لایحه تجدیدنظرخواهی',
    usageNotes: `${DISCLAIMER} مهلت و آیین تجدیدنظر را رعایت کنید.`,
    body: `ریاست محترم دادگاه تجدیدنظر {{court_name}}

لایحه تجدیدنظرخواهی

تجدیدنظرخواه: {{client_name}}
شماره پرونده: {{case_number}}

گردش کار و خواسته:
[…]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'pleading-enforcement',
    category: 'pleading',
    title: 'لایحه درخواست اجرای حکم',
    usageNotes: `${DISCLAIMER} مشخصات حکم و مرجع صدور را درج کنید.`,
    body: `ریاست محترم دادگاه {{court_name}}

درخواست اجرای حکم

موکل: {{client_name}} — پرونده: {{case_number}}
خوانده: {{opponent_name}}

خواسته: اجرای حکم [شماره/تاریخ]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'declaration-debt',
    category: 'declaration',
    title: 'اظهارنامه مطالبه وجه',
    usageNotes: `${DISCLAIMER} قبل از ارسال، اصلاحیه‌های لازم را اعمال کنید.`,
    body: `ریاست محترم دفتر خدمات قضایی

اظهارنامه

اظهارکننده: {{client_name}} — نشانی: {{client_address}}
طرف مقابل: {{opponent_name}}

موضوع: مطالبه وجه {{claim_amount}} ریال

متن:
[…]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'contract-legal-services',
    category: 'contract',
    title: 'قرارداد ارائه خدمات حقوقی',
    usageNotes: `${DISCLAIMER} حق‌الوکاله و تعهدات را شفاف کنید.`,
    body: `قرارداد ارائه خدمات حقوقی

موکل: {{client_name}} — {{client_national_id}}
وکیل: {{lawyer_name}} — {{lawyer_phone}}

موضوع: [خدمات حقوقی در پرونده {{case_number}}]

حق‌الوکاله: {{claim_amount}} ریال
تاریخ قرارداد: {{contract_date}}

امضا طرفین`
  },
  {
    slug: 'contract-nda',
    category: 'contract',
    title: 'قرارداد محرمانگی',
    usageNotes: `${DISCLAIMER} دامنه اطلاعات محرمانه را تعریف کنید.`,
    body: `قرارداد محرمانگی

طرف اول: {{client_name}}
طرف دوم: {{lawyer_name}}

موضوع: حفظ محرمانگی اطلاعات مرتبط با […]

مدت: از {{contract_date}}

امضا`
  },
  {
    slug: 'court-inquiry',
    category: 'court_request',
    title: 'درخواست استعلام',
    usageNotes: `${DISCLAIMER} مرجع استعلام و سوالات را دقیق بنویسید.`,
    body: `ریاست محترم دادگاه {{court_name}}

درخواست استعلام

پرونده: {{case_number}} — موکل: {{client_name}}

استعلام از: [مرجع]
موضوع: […]

تاریخ: {{document_date}}
{{lawyer_name}}`
  },
  {
    slug: 'court-file-study',
    category: 'court_request',
    title: 'درخواست مطالعه پرونده',
    usageNotes: `${DISCLAIMER}`,
    body: `ریاست محترم دادگاه {{court_name}}

درخواست مطالعه پرونده

وکیل: {{lawyer_name}}
شماره پرونده: {{case_number}}

تاریخ: {{document_date}}`
  },
  {
    slug: 'office-client-intake',
    category: 'office',
    title: 'فرم مشخصات موکل',
    usageNotes: 'برای تکمیل پرونده در دفتر — اطلاعات را از موکل بگیرید.',
    body: `مشخصات موکل

نام: {{client_name}}
کد ملی: {{client_national_id}}
نشانی: {{client_address}}
تلفن: {{lawyer_phone}}

موضوع پرونده: […]
شماره پرونده: {{case_number}}
تاریخ: {{document_date}}`
  },
  {
    slug: 'office-doc-receipt',
    category: 'office',
    title: 'رسید دریافت مدارک',
    usageNotes: 'لیست مدارک دریافتی را کامل کنید.',
    body: `رسید دریافت مدارک

موکل: {{client_name}}
تاریخ: {{document_date}}

مدارک دریافت‌شده:
1. […]
2. […]

تحویل‌گیرنده: {{lawyer_name}}`
  }
];

function getSystemBySlug(slug) {
  return SYSTEM_LEGAL_TEMPLATES.find((t) => t.slug === slug) || null;
}

function mapSystemTemplate(t) {
  return {
    id: `system-${t.slug}`,
    systemSlug: t.slug,
    isSystem: true,
    title: t.title,
    body: t.body,
    content: t.body,
    text: t.body,
    category: t.category,
    cat: t.category,
    usageNotes: t.usageNotes,
    usage_notes: t.usageNotes,
    updated_at: null,
    created_at: null
  };
}

module.exports = {
  SYSTEM_LEGAL_TEMPLATES,
  getSystemBySlug,
  mapSystemTemplate
};
