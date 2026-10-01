/**
 * Public claim tracking constants.
 * Pure data mapping for customer-facing tracking views.
 */

const PUBLIC_STATUSES = Object.freeze([
  'RECEIVED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'CLOSED',
]);

const PUBLIC_STATUS_MAP = Object.freeze({
  NEW: {
    status: 'RECEIVED',
    statusDescription: 'تم استلام بلاغك وهو قيد المعالجة',
  },
  PENDING_ACCEPTANCE: {
    status: 'RECEIVED',
    statusDescription: 'تم استلام بلاغك وهو قيد المعالجة',
  },
  ASSIGNED: {
    status: 'RECEIVED',
    statusDescription: 'تم تعيين معاين لمطالبتك وسيباشر المعاينة قريباً',
  },
  IN_PROGRESS: {
    status: 'IN_PROGRESS',
    statusDescription: 'مركبتك قيد المعاينة الميدانية من قبل المفتش المختص',
  },
  CORRECTION_REQUIRED: {
    status: 'IN_PROGRESS',
    statusDescription: 'يجري استكمال بعض المعلومات على مطالبتك',
  },
  SUBMITTED: {
    status: 'IN_REVIEW',
    statusDescription: 'ملف مطالبتك قيد المراجعة والتدقيق',
  },
  UNDER_REVIEW: {
    status: 'IN_REVIEW',
    statusDescription: 'ملف مطالبتك قيد المراجعة والتدقيق',
  },
  APPROVED: {
    status: 'APPROVED',
    statusDescription: 'صدر القرار بالموافقة على مطالبتك',
  },
  REJECTED: {
    status: 'REJECTED',
    statusDescription: 'صدر القرار برفض مطالبتك، يرجى مراجعة شركة التأمين للتفاصيل',
  },
  CLOSED: {
    status: 'CLOSED',
    statusDescription: 'تم إغلاق مطالبتك وإتمام التسوية',
  },
});

const PUBLIC_TIMELINE_TEXT = Object.freeze({
  RECEIVED: {
    title: 'تم استلام البلاغ',
    description: 'تم تسجيل البلاغ بنجاح وفتح ملف المطالبة في النظام',
  },
  IN_PROGRESS: {
    title: 'بدء المعاينة الميدانية',
    description: 'باشر المعاين فحص أضرار المركبة في الموقع وتوثيق الأدلة',
  },
  IN_REVIEW: {
    title: 'قيد المراجعة والتدقيق',
    description: 'اكتملت المعاينة وتجري الآن مراجعة الملف وتدقيقه',
  },
  APPROVED: {
    title: 'صدر القرار: موافقة',
    description: 'تمت الموافقة على المطالبة',
  },
  REJECTED: {
    title: 'صدر القرار: رفض',
    description: 'تم رفض المطالبة',
  },
  CLOSED: {
    title: 'تم الإغلاق والتسوية',
    description: 'تم إغلاق المطالبة وإتمام التسوية',
  },
});

const PUBLIC_STATUS_RANK = Object.freeze({
  RECEIVED: 1,
  IN_PROGRESS: 2,
  IN_REVIEW: 3,
  APPROVED: 4,
  REJECTED: 4,
  CLOSED: 5,
});

module.exports = {
  PUBLIC_STATUSES,
  PUBLIC_STATUS_MAP,
  PUBLIC_STATUS_RANK,
  PUBLIC_TIMELINE_TEXT,
};
