const { toMinor } = require('../../utils/money');
const { normalizeGarageName } = require('../../modules/garages/garage.service');

const ARABIC_FIRST_NAMES = [
  'محمد', 'أحمد', 'محمود', 'علي', 'عمر', 'خالد', 'يوسف', 'إبراهيم', 'طارق', 'سامي',
  'باسل', 'زياد', 'سمير', 'فادي', 'جميل', 'حسن', 'كريم', 'نبيل', 'رامي', 'ماهر',
  'سارة', 'فاطمة', 'مريم', 'نور', 'ليلى', 'رنا', 'هدى', 'دينا', 'ياسمين', 'منى',
  'سلوى', 'عبير', 'ريما', 'لمى', 'أمل', 'شهد', 'هالة', 'وليد', 'صالح', 'ماجد',
];

const ARABIC_LAST_NAMES = [
  'التميمي', 'النتشة', 'الرجبي', 'القواسمي', 'البديري', 'الخطيب', 'عبد الله', 'الحلبي', 'الناظر', 'منصور',
  'صالح', 'جابر', 'خليل', 'حمدان', 'عياش', 'بركات', 'عثمان', 'سليمان', 'شاهين', 'درويش',
  'الجعبري', 'الهشلمون', 'شريتح', 'البرغوثي', 'الزغير', 'عواد', 'شعبان', 'المصري', 'شريف', 'زيدان',
];

const GOVERNORATE_PLATE_LETTERS = Object.freeze({
  JENIN: ['A'],
  TULKARM: ['B'],
  TUBAS: ['C'],
  NABLUS: ['D'],
  QALQILYA: ['E'],
  SALFIT: ['F'],
  JERICHO: ['G'],
  RAMALLAH_AL_BIREH: ['H'],
  JERUSALEM: ['J'],
  BETHLEHEM: ['K'],
  HEBRON: ['L', 'M', 'N'],
});

const WEST_BANK_GOVERNORATES = Object.keys(GOVERNORATE_PLATE_LETTERS);

const VEHICLE_MAKES_MODELS = [
  // Hyundai (~35%)
  { make: 'Hyundai', model: 'Tucson', weight: 12 },
  { make: 'Hyundai', model: 'Elantra', weight: 12 },
  { make: 'Hyundai', model: 'Accent', weight: 7 },
  { make: 'Hyundai', model: 'Ioniq', weight: 4 },
  // Kia (~25%)
  { make: 'Kia', model: 'Sportage', weight: 12 },
  { make: 'Kia', model: 'Cerato', weight: 8 },
  { make: 'Kia', model: 'Picanto', weight: 5 },
  // Skoda (~20%)
  { make: 'Skoda', model: 'Octavia', weight: 14 },
  { make: 'Skoda', model: 'Superb', weight: 6 },
  // Volkswagen (~15%)
  { make: 'Volkswagen', model: 'Golf', weight: 7 },
  { make: 'Volkswagen', model: 'Passat', weight: 5 },
  { make: 'Volkswagen', model: 'Caddy', weight: 3 },
  // Other (~5%)
  { make: 'Toyota', model: 'Corolla', weight: 3 },
  { make: 'Seat', model: 'Leon', weight: 2 },
];

const VEHICLE_COLORS = ['White', 'Black', 'Silver', 'Grey', 'Blue', 'Red'];

const DEMO_GARAGES_DATA = [
  // RAMALLAH_AL_BIREH (2 approved)
  {
    name: 'ورشة المنارة المركزية',
    governorate: 'RAMALLAH_AL_BIREH',
    city: 'رام الله',
    laborRate: toMinor(80, 'ILS'),
    approved: true,
  },
  {
    name: 'كراج الأمل لصيانة السيارات',
    governorate: 'RAMALLAH_AL_BIREH',
    city: 'البيرة',
    laborRate: toMinor(85, 'ILS'),
    approved: true,
  },
  // NABLUS (2 approved)
  {
    name: 'مركز نابلس الفني المتقدم',
    governorate: 'NABLUS',
    city: 'نابلس',
    laborRate: toMinor(75, 'ILS'),
    approved: true,
  },
  {
    name: 'ورشة جبل النار للسيارات',
    governorate: 'NABLUS',
    city: 'نابلس',
    laborRate: toMinor(80, 'ILS'),
    approved: true,
  },
  // HEBRON (2 approved)
  {
    name: 'كراج الخليل الهندسي الحديث',
    governorate: 'HEBRON',
    city: 'الخليل',
    laborRate: toMinor(70, 'ILS'),
    approved: true,
  },
  {
    name: 'مركز الوفاء الميكانيكي',
    governorate: 'HEBRON',
    city: 'الخليل',
    laborRate: toMinor(75, 'ILS'),
    approved: true,
  },
  // BETHLEHEM (2 approved)
  {
    name: 'كراج المهد النموذجي',
    governorate: 'BETHLEHEM',
    city: 'بيت لحم',
    laborRate: toMinor(85, 'ILS'),
    approved: true,
  },
  {
    name: 'ورشة الزيتون الفنية',
    governorate: 'BETHLEHEM',
    city: 'بيت جالا',
    laborRate: toMinor(80, 'ILS'),
    approved: true,
  },
  // JENIN (1 approved, 1 unapproved)
  {
    name: 'مركز مرج ابن عامر الفني',
    governorate: 'JENIN',
    city: 'جنين',
    laborRate: toMinor(70, 'ILS'),
    approved: true,
  },
  {
    name: 'ورشة جنين لتجليس ودهان السيارات',
    governorate: 'JENIN',
    city: 'جنين',
    laborRate: toMinor(65, 'ILS'),
    approved: false,
  },
  // TULKARM (1 approved, 1 unapproved)
  {
    name: 'كراج الكرمة لخدمات المركبات',
    governorate: 'TULKARM',
    city: 'طولكرم',
    laborRate: toMinor(75, 'ILS'),
    approved: true,
  },
  {
    name: 'ورشة وادي الشعير للسيارات',
    governorate: 'TULKARM',
    city: 'عنبتا',
    laborRate: toMinor(60, 'ILS'),
    approved: false,
  },
].map((g) => ({
  ...g,
  normalizedName: normalizeGarageName(g.name),
}));

const DEMO_STAFF_DEFINITIONS = [
  {
    employeeCode: 'DM-AD-001',
    name: 'طارق عبد الرحيم',
    role: 'ADMIN',
    canRecordPayments: false,
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-CO-001',
    name: 'سارة مصطفى عبد الله',
    role: 'CLAIMS_OFFICER',
    canRecordPayments: true,
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-CO-002',
    name: 'عمر خليل الحلبي',
    role: 'CLAIMS_OFFICER',
    canRecordPayments: false,
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-001',
    name: 'أحمد جميل البديري',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-001',
    surveyorLicenseExpiry: '2028-12-31',
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-002',
    name: 'محمود شريف الرجبي',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-002',
    surveyorLicenseExpiry: '2028-12-31',
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-003',
    name: 'خالد فؤاد النتشة',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-003',
    surveyorLicenseExpiry: '2028-12-31',
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-004',
    name: 'زياد سامي الخطيب',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-004',
    surveyorLicenseExpiry: '2028-12-31',
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-005',
    name: 'باسل حسام التميمي',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-005',
    surveyorLicenseExpiry: '2028-12-31',
    status: 'ACTIVE',
  },
  {
    employeeCode: 'DM-FA-006',
    name: 'سمير عادل القواسمي',
    role: 'FIELD_ADJUSTER',
    surveyorLicenseNumber: 'SAWN-FA-006',
    surveyorLicenseExpiry: '2023-12-31', // Expired license
    status: 'ACTIVE',
  },
];

module.exports = {
  ARABIC_FIRST_NAMES,
  ARABIC_LAST_NAMES,
  GOVERNORATE_PLATE_LETTERS,
  WEST_BANK_GOVERNORATES,
  VEHICLE_MAKES_MODELS,
  VEHICLE_COLORS,
  DEMO_GARAGES_DATA,
  DEMO_STAFF_DEFINITIONS,
};
