/**
 * Tool catalog — status "ready" only when backend calculator exists and does not rely on unverified legal rates.
 */
const CATEGORIES = Object.freeze([
  { id: 'family', title: 'خانواده' },
  { id: 'criminal', title: 'کیفری' },
  { id: 'financial', title: 'مالی و قضایی' },
  { id: 'cheque', title: 'چک و سفته' },
  { id: 'contracts', title: 'قراردادها' },
  { id: 'dates', title: 'تاریخ و مهلت‌های قانونی' },
  { id: 'inheritance', title: 'ارث' },
  { id: 'other', title: 'سایر ابزارهای پرکاربرد' }
]);

const TOOLS = Object.freeze([
  {
    slug: 'date-diff',
    title: 'فاصله دو تاریخ',
    category: 'dates',
    status: 'ready',
    description: 'محاسبه تعداد روز بین دو تاریخ میلادی (برای تبدیل به تقویم رسمی پرونده از مستندات دادگاه استفاده کنید).',
    legalBasis: 'محاسبه تقویمی؛ بدون استناد به ماده خاص.'
  },
  {
    slug: 'deadline-add',
    title: 'افزودن روز به تاریخ (مهلت)',
    category: 'dates',
    status: 'ready',
    description: 'تاریخ شروع + تعداد روز — برای محاسبه مهلت پس از تعیین مدت در قانون یا قرار.',
    legalBasis: 'محاسبه تقویمی؛ مدت قانونی را خودتان از متن قانون وارد کنید.'
  },
  {
    slug: 'delay-interest-user-rate',
    title: 'خسارت تأخیر (نرخ ورودی کاربر)',
    category: 'financial',
    status: 'ready',
    description: 'سود ساده بر اساس اصل، نرخ سالانه و تعداد روز — نرخ را از ماده قانونی یا قرارداد وارد کنید.',
    legalBasis: 'فرمول سود ساده؛ نرخ قانونی در سامانه ثبت نشده است.'
  },
  {
    slug: 'mehr-calc',
    title: 'محاسبه مهریه',
    category: 'family',
    status: 'coming_soon',
    description: 'نیاز به جدول/نرخ رسمی و قواعد محاسبه — پس از بارگذاری منبع معتبر فعال می‌شود.'
  },
  {
    slug: 'court-fees',
    title: 'هزینه دادرسی',
    category: 'financial',
    status: 'coming_soon',
    description: 'نیاز به جدول هزینه دادرسی مصوب — بدون داده معتبر در سامانه.'
  },
  {
    slug: 'attorney-fee',
    title: 'حق‌الوکاله',
    category: 'financial',
    status: 'coming_soon',
    description: 'نیاز به تعرفه رسمی یا قرارداد — ابزار پرونده در دادبان جداگانه موجود است.'
  },
  {
    slug: 'diyeh',
    title: 'محاسبات دیه',
    category: 'criminal',
    status: 'coming_soon',
    description: 'نیاز به مبالغ دیه مصوب سال — بدون جدول معتبر در سامانه.'
  },
  {
    slug: 'cheque-tools',
    title: 'چک و سفته',
    category: 'cheque',
    status: 'coming_soon',
    description: 'محاسبات تخصصی پس از تعریف منابع قانونی معتبر.'
  },
  {
    slug: 'inheritance-share',
    title: 'سهم‌الارث',
    category: 'inheritance',
    status: 'coming_soon',
    description: 'نیاز به قواعد فقهی/قانونی و ورودی‌های کامل وراث — در حال تکمیل.'
  }
]);

function listCatalog() {
  return {
    categories: CATEGORIES,
    tools: TOOLS.map((t) => ({ ...t }))
  };
}

function getTool(slug) {
  return TOOLS.find((t) => t.slug === slug) || null;
}

module.exports = { CATEGORIES, TOOLS, listCatalog, getTool };
