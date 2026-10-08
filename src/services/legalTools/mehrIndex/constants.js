/** Official audit fixture coverage — CBI letter 10899/02 (1402/01/22). */
const DATASET_VERSION = 'cbi-mehrih-annual-index-10899-02-1402-01-22';
const CALENDAR_SYSTEM = 'jalali';
const MIN_YEAR = 1315;
const MAX_YEAR = 1401;
/** Last jalali index year in official dataset (10899/02). */
const MAX_INDEX_YEAR = 1401;
/** Max payment/death reference year: numerator uses referenceYear - 1 → 1402 → index 1401. */
const MAX_REFERENCE_YEAR = 1402;
const SOURCE_NUMBER = '10899/02';
const OFFICIAL_SOURCE_URL = 'https://nezamat.ir/post-44530/';
const INDEX_NOT_AVAILABLE_MESSAGE =
  'شاخص رسمی مورد نیاز برای این محاسبه در سامانه موجود نیست.';

module.exports = {
  DATASET_VERSION,
  CALENDAR_SYSTEM,
  MIN_YEAR,
  MAX_YEAR,
  MAX_INDEX_YEAR,
  MAX_REFERENCE_YEAR,
  SOURCE_NUMBER,
  OFFICIAL_SOURCE_URL,
  INDEX_NOT_AVAILABLE_MESSAGE
};
