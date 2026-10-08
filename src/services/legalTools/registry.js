/**
 * Tool catalog — status "ready" only when backend calculator exists and does not rely on unverified legal rates.
 */
const INACTIVE_MSG = 'پس از ورود منبع رسمی و قابل اعتبارسنجی فعال می‌شود.';

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
      'محاسبه کمکی مهریه وجه رایج بر اساس شاخص‌های سالانه واردشده در سامانه (فقط وجه رایج؛ بدون سکه و طلا).'
  },
  {
    slug: 'court-fees',
    title: 'هزینه دادرسی',
    category: 'financial',
    status: 'coming_soon',
    inactiveReason: INACTIVE_MSG,
    description: `تعرفه رسمی هزینه دادرسی در سامانه وارد نشده است. ${INACTIVE_MSG}`
  },
  {
    slug: 'attorney-fee',
    title: 'حق‌الوکاله',
    category: 'financial',
    status: 'coming_soon',
    inactiveReason: INACTIVE_MSG,
    description: `تعرفه رسمی حق‌الوکاله در سامانه وارد نشده است. ${INACTIVE_MSG}`
  },
  {
    slug: 'diyeh',
    title: 'محاسبات دیه',
    category: 'criminal',
    status: 'coming_soon',
    inactiveReason: INACTIVE_MSG,
    description: `جدول سالانه دیه مصوب در سامانه وارد نشده است. ${INACTIVE_MSG}`
  },
  {
    slug: 'cheque-tools',
    title: 'چک و سفته',
    category: 'cheque',
    status: 'coming_soon',
    inactiveReason: INACTIVE_MSG,
    description: `قواعد و جداول رسمی محاسباتی چک/سفته در سامانه آماده نیست. ${INACTIVE_MSG}`
  },
  {
    slug: 'inheritance-share',
    title: 'سهم‌الارث',
    category: 'inheritance',
    status: 'coming_soon',
    inactiveReason: INACTIVE_MSG,
    description: `موتور قواعد ارث با منبع رسمی و قابل اعتبارسنجی در سامانه آماده نیست. ${INACTIVE_MSG}`
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

module.exports = { CATEGORIES, TOOLS, listCatalog, getTool, INACTIVE_MSG };
