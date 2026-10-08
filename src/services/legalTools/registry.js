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
    title: 'فاصله دو تاریخ میلادی',
    category: 'dates',
    status: 'ready',
    description:
      'این ابزار فاصله تقویمی بین دو تاریخ میلادی را محاسبه می‌کند و جایگزین محاسبه مهلت قانونی یا تعطیلات رسمی نیست.'
  },
  {
    slug: 'deadline-add',
    title: 'محاسبه تاریخ پایان مهلت (میلادی)',
    category: 'dates',
    status: 'ready',
    description: 'تاریخ شروع میلادی + تعداد روز. مدت مهلت را بر حسب تعداد روز وارد کنید.'
  },
  {
    slug: 'delay-interest-user-rate',
    title: 'سود ساده (نرخ ورودی کاربر)',
    category: 'financial',
    status: 'ready',
    description:
      'محاسبه سود ساده بر اساس اصل، نرخ سالانه و تعداد روز — نرخ را خودتان وارد می‌کنید؛ نرخ رسمی در سامانه اعمال نمی‌شود.'
  },
  {
    slug: 'mehr-calc',
    title: 'محاسبه مهریه',
    category: 'family',
    status: 'ready',
    description:
      'محاسبه تقریبی/آموزشی ارزش روز مهریه وجه رایج بر اساس شاخص‌های سالانه ثبت‌شده در سامانه.'
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
