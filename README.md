# 🛡️ InsurFlow — Backend API

> **نظام إدارة مطالبات التأمين على المركبات**  
> A multi-tenant insurance claims management backend built with Node.js, Express, and MongoDB.

---

## 📖 ما هو InsurFlow؟

InsurFlow هو نظام إدارة مطالبات التأمين على السيارات. الفكرة الأساسية هي أن شركات التأمين تستخدم هذا النظام لإدارة عملية تسوية الحوادث من البداية للنهاية.

**المشكلة التي يحلها:**  
عند وقوع حادث سيارة، يحتاج العميل إلى تقديم مطالبة تأمينية. هذا النظام يُنظّم العملية كاملة:
1. موظف المطالبات يفتح الملف
2. يُعيّن مفتشًا ميدانيًا متاحًا يذهب لمكان الحادث
3. المفتش يبدأ المعاينة ويجمع البيانات (السيارة، الحادث، الموقع)
4. المفتش يُرسل تقرير الفحص المكتمل
5. الموظف يراجع التقرير (مع إمكانية طلب تصحيحات من المفتش)
6. يُعتمد التعويض أو يُرفض
7. الإدارة تُغلق الملف نهائيًا بعد صرف المستحقات

---

## 🏗️ البنية التقنية للمشروع

### التقنيات المستخدمة

| التقنية | الإصدار | الغرض |
|---------|---------|-------|
| **Node.js** | Latest LTS | بيئة التشغيل |
| **Express.js** | v5.x | إطار عمل الـ API |
| **MongoDB** | - | قاعدة البيانات |
| **Mongoose** | v9.x | ODM (التعامل مع MongoDB) |
| **JWT (jsonwebtoken)** | v9.x | المصادقة وتوليد الرمز |
| **bcrypt** | v6.x | تشفير كلمات المرور |
| **Joi** | v18.x | التحقق من صحة البيانات |
| **Helmet** | v8.x | أمان الـ HTTP headers |
| **Morgan** | v1.x | تسجيل الطلبات (logging) |
| **Multer** | v2.x | معالجة رفع الملفات والوسائط في الذاكرة |
| **Cloudinary** | v2.x | التخزين السحابي لصور الأدلة والتوقيع الرقمي |
| **Jest + Supertest** | v29.x | اختبارات تلقائية |

### الاعتماديات للتطوير فقط

| التقنية | الغرض |
|---------|-------|
| **nodemon** | إعادة تشغيل السيرفر تلقائيًا عند تعديل الكود |
| **mongodb-memory-server** | قاعدة بيانات وهمية للاختبارات |
| **cross-env** | توحيد متغيرات البيئة بين Windows/Linux |

---

## 📁 هيكل الملفات — شرح مفصل

```
INSURFLOW/
│
├── src/                          ← كل الكود البرمجي هنا
│   │
│   ├── server.js                 ← نقطة البداية: يشغّل السيرفر
│   ├── app.js                    ← إعداد التطبيق (middlewares, routes)
│   │
│   ├── config/                   ← إعدادات المشروع
│   │   ├── env.js                ← قراءة متغيرات البيئة (.env)
│   │   ├── database.js           ← الاتصال بـ MongoDB
│   │   └── cloudinary.js         ← إعداد الربط مع Cloudinary
│   │
│   ├── middlewares/              ← وسطاء الطلبات (تُنفَّذ قبل كل endpoint)
│   │   ├── auth.middleware.js    ← التحقق من الـ JWT token
│   │   ├── role.middleware.js    ← التحقق من صلاحية الدور
│   │   ├── validate.middleware.js← التحقق من المدخلات بواسطة Joi
│   │   ├── upload.middleware.js  ← معالجة رفع الصور في الذاكرة (10MB)
│   │   ├── rateLimiter.middleware.js ← تحديد معدل الطلبات وحماية الهجمات
│   │   ├── errorHandler.js       ← معالج الأخطاء العام
│   │   └── notFound.js           ← معالج الـ 404
│   │
│   ├── utils/                    ← أدوات مساعدة عامة
│   │   ├── apiResponse.js        ← تنسيق موحد للردود
│   │   ├── appError.js           ← كلاس مخصص للأخطاء
│   │   ├── counter.model.js      ← عداد لتوليد أرقام المطالبات
│   │   └── uploadToCloudinary.js ← أداة رفع الملفات عبر Streams لـ Cloudinary
│   │
│   ├── scripts/
│   │   └── seedMockData.js       ← سكريبت لإدخال بيانات تجريبية
│   │
│   └── modules/                  ← كل وحدة وظيفية منفصلة
│       │
│       ├── auth/                 ← وحدة المصادقة
│       │   ├── auth.routes.js
│       │   ├── auth.controller.js
│       │   ├── auth.service.js
│       │   └── auth.validation.js
│       │
│       ├── claims/               ← وحدة المطالبات (الأهم في المشروع)
│       │   ├── claim.routes.js
│       │   ├── claim.controller.js
│       │   ├── claim.service.js
│       │   ├── claim.repository.js
│       │   ├── claim.model.js
│       │   └── claim.validation.js
│       │
│       ├── users/                ← وحدة المستخدمين
│       │   ├── user.routes.js
│       │   ├── user.controller.js
│       │   ├── user.service.js
│       │   ├── user.repository.js
│       │   └── user.model.js
│       │
│       ├── vehicles/             ← وحدة المركبات
│       │   ├── vehicle.routes.js
│       │   ├── vehicle.controller.js
│       │   ├── vehicle.service.js
│       │   ├── vehicle.repository.js
│       │   ├── vehicle.model.js
│       │   └── vehicle.validation.js
│       │
│       ├── organizations/        ← وحدة المؤسسات (Model فقط)
│       │   └── organization.model.js
│       │
│       ├── customers/            ← وحدة العملاء (Model + Repository فقط)
│       │   ├── customer.model.js
│       │   └── customer.repository.js
│       │
│       └── policies/             ← وحدة وثائق التأمين (Model + Repository فقط)
│           ├── policy.model.js
│           └── policy.repository.js
│
├── tests/                        ← الاختبارات التلقائية (17 Suites / 208 Tests)
├── docs/                         ← التوثيق والـ API Contracts ومواصفات الميزات
├── .env.example                  ← نموذج متغيرات البيئة المطلوبة
├── package.json
└── README.md
```

---

## 🚀 كيفية تشغيل المشروع

### 1. المتطلبات الأساسية

- Node.js (LTS)
- MongoDB (محلي أو Atlas)

### 2. تثبيت المشروع

```bash
# نسخ المشروع
git clone <repo-url>

# تثبيت الاعتماديات
npm install
```

### 3. إعداد متغيرات البيئة

```bash
# انسخ ملف المثال
copy .env.example .env
```

ثم افتح ملف `.env` وأضف القيم:

```env
PORT=3000
DATABASE_URL=mongodb://localhost:27017/insurflow
JWT_SECRET=your-super-secret-key-here
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development

# ── Cloudinary Configuration (إلزامية لرفع صور الأدلة والتوقيع الرقمي) ──
CLOUDINARY_CLOUD_NAME=your_cloud_name      # اسم السحابة / الحساب على Cloudinary
CLOUDINARY_API_KEY=your_api_key            # مفتاح الـ API العام للربط البرمجي
CLOUDINARY_API_SECRET=your_api_secret      # المفتاح السري للـ API
```

> **ملاحظة حول Cloudinary:**  
> تُستخدم متغيرات Cloudinary الثلاثة لتهيئة SDK في `src/config/cloudinary.js`. عند تشغيل السيرفر في وضع التطوير أو الإنتاج، يتحقق `src/config/env.js` من وجودها إلزاميًا (Fail-fast). أما في بيئة الاختبار (`NODE_ENV=test`)، يتم عمل Mock كامل لعمليات الرفع بدون الحاجة لبيانات حقيقية.

### 4. إدخال البيانات التجريبية (مهم!)

```bash
node src/scripts/seedMockData.js
```

هذا السكريبت يُنشئ:
- مؤسسة تجريبية باسم `Demo Insurance Co` وكود `DEMO-INS`
- عميلان تجريبيان (John Doe، Jane Smith)
- وثيقتا تأمين (ACTIVE و EXPIRED)
- مركبتان مرتبطتان بالعملاء والوثائق

### 5. تشغيل السيرفر

```bash
# للتطوير (يُعاد التشغيل تلقائيًا عند تعديل الكود)
npm run dev

# للإنتاج
npm start
```

السيرفر يعمل على: `http://localhost:3000`

### 6. التحقق من أن السيرفر يعمل

```bash
curl http://localhost:3000/health
```

يجب أن يرجع:
```json
{ "success": true, "message": "Backend service is running properly" }
```

### 7. تشغيل الاختبارات

```bash
npm test
```

---

## 🔑 المفاهيم الأساسية

### Multi-Tenancy (تعدد المؤسسات)

النظام مصمم لخدمة **أكثر من شركة تأمين** في نفس الوقت. كل شركة لها:
- كود مميز (مثل `DEMO-INS`)
- موظفوها الخاصون
- مطالباتها الخاصة

**القاعدة الذهبية:** لا يُمكن لأي مستخدم رؤية بيانات شركة أخرى أبدًا.  
`organizationId` يُستخرج دائمًا من الـ JWT token، لا من الطلب.

### الأدوار (Roles)

| الدور | الصلاحيات |
|-------|-----------|
| `CLAIMS_OFFICER` | إنشاء مطالبة، تعيين مفتش، بدء المراجعة، طلب تصحيح، اتخاذ قرار الاعتماد/الرفض |
| `FIELD_ADJUSTER` | عرض المطالبات المُعيّنة له، بدء/استئناف المعاينة، حفظ مسودات الفحص، رفع صور الأدلة والتوقيع الرقمي، إرسال التقرير |
| `ADMIN` | إدارة الموظفين، الرقابة الشاملة، اتخاذ قرار الاعتماد/الرفض، إغلاق المطالبة نهائيًا |

### JWT Authentication (المصادقة)

عند تسجيل الدخول، يُعطى المستخدم **رمز JWT** يحتوي على:
```json
{
  "userId": "...",
  "role": "CLAIMS_OFFICER",
  "organizationId": "..."
}
```

هذا الرمز يُرسَل مع كل طلب في الـ header:
```
Authorization: Bearer <token>
```

صلاحية الرمز: **8 ساعات**

---

## 🔄 دورة حياة المطالبة (The Claim Lifecycle)

## 🔄 دورة حياة المطالبة (The Claim Lifecycle)

هذا هو قلب النظام. تدعم المنصة آلة حالات متكاملة من 9 حالات مع حلقة تصحيح تفاعلية:

```
NEW → ASSIGNED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED → CLOSED
                              ▲                       │
                              │                       ▼
                              └─── CORRECTION_REQUIRED ◄── (طلب تصحيح)
```

### شرح كل مرحلة:

```
1. NEW
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims
   └── ماذا يحدث: يُنشئ ملف المطالبة بالمعلومات الأساسية (CLM-<ORG>-0001)

2. ASSIGNED  
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims/:id/assign
   └── ماذا يحدث: يُعيّن مفتشًا ميدانيًا متاحًا (لديه 3 مهام نشطة أو أقل)

3. IN_PROGRESS
   ├── من يفعلها: FIELD_ADJUSTER
   ├── كيف: POST /api/v1/claims/:id/inspection/start
   └── ماذا يحدث: يبدأ المفتش المعاينة ميدانياً ويسجل المسودات (المركبة، الحادث، الموقع)

4. SUBMITTED
   ├── من يفعلها: FIELD_ADJUSTER
   ├── كيف: POST /api/v1/claims/:id/inspection/submit
   └── ماذا يحدث: يُسلّم التقرير بعد التحقق من الأركان الإلزامية الخمسة (المركبة، الحادث، الموقع، صور الأدلة، والتوقيع الرقمي)

5. UNDER_REVIEW
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims/:id/review/start
   └── ماذا يحدث: الموظف يفتح التقرير ويبدأ المراجعة والتدقيق

6. CORRECTION_REQUIRED (حلقة التصحيح)
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims/:id/review/request-correction
   └── ماذا يحدث: الموظف يطلب تعديلات محددة بملاحظات إجبارية، ليعود المفتش ويستأنف المعاينة

7. APPROVED / REJECTED (القرار النهائي)
   ├── من يفعلها: CLAIMS_OFFICER أو ADMIN
   ├── كيف: POST /api/v1/claims/:id/decision
   └── ماذا يحدث: اتخاذ قرار الموافقة على التعويض أو رفض المطالبة مع تدوين الأسباب

8. CLOSED (الإغلاق النهائي)
   ├── من يفعلها: ADMIN حصرًا
   ├── كيف: POST /api/v1/claims/:id/close
   └── ماذا يحدث: بعد تسوية التعويضات، تغلق الإدارة الملف نهائيًا وتؤرشفه
```

---

## 📡 API Endpoints — جميع الـ Endpoints المُنفَّذة

**Base URL:** `http://localhost:3000/api/v1`

### 🔐 المصادقة والحساب (Authentication)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `POST` | `/auth/login` | الكل | تسجيل الدخول والحصول على JWT (محمي بـ loginLimiter) |
| `PUT` | `/auth/change-password` | الكل (مسجل الدخول) | تغيير كلمة المرور الذاتي للمستخدم |

---

### 📋 المطالبات والمعاينة الميدانية (Claims & Inspection)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `POST` | `/claims` | CLAIMS_OFFICER | إنشاء مطالبة جديدة |
| `GET` | `/claims` | الكل* | عرض قائمة المطالبات (مع الهيدرز للـ Pagination) |
| `GET` | `/claims/:claimId` | الكل* | عرض تفاصيل المطالبة وسجل الـ Timeline |
| `POST` | `/claims/:claimId/assign` | CLAIMS_OFFICER | تعيين مفتش متاح للمطالبة |
| `POST` | `/claims/:claimId/inspection/start` | FIELD_ADJUSTER | بدء أو استئناف المعاينة الميدانية (`IN_PROGRESS`) |
| `PUT` | `/claims/:claimId/vehicle` | FIELD_ADJUSTER | ربط بيانات المركبة والوثيقة والعميل |
| `PUT` | `/claims/:claimId/accident` | FIELD_ADJUSTER | تسجيل تفاصيل وأضرار الحادث |
| `PUT` | `/claims/:claimId/location` | FIELD_ADJUSTER | تسجيل إحداثيات الموقع (GPS) |
| `POST` | `/claims/:claimId/evidence` | FIELD_ADJUSTER | رفع صور الأدلة الميدانية مصنفة لسحابة Cloudinary |
| `POST` | `/claims/:claimId/signature` | FIELD_ADJUSTER | التقاط وحفظ التوقيع الرقمي للمعاينة لسحابة Cloudinary |
| `POST` | `/claims/:claimId/inspection/submit` | FIELD_ADJUSTER | إرسال تقرير الفحص المكتمل (التحقق من الأركان الـ 5) |
| `POST` | `/claims/:claimId/review/start` | CLAIMS_OFFICER | بدء تدقيق ومراجعة التقرير |
| `POST` | `/claims/:claimId/review/request-correction` | CLAIMS_OFFICER | إرجاع المطالبة للمفتش للتصحيح مع ملاحظات |
| `POST` | `/claims/:claimId/decision` | CLAIMS_OFFICER / ADMIN | اعتماد (`APPROVED`) أو رفض (`REJECTED`) المطالبة |
| `POST` | `/claims/:claimId/close` | ADMIN | إغلاق وأرشفة المطالبة المعتمدة نهائيًا |
| `GET` | `/claims/stats` | الكل* | تجميع إحصائيات ومؤشرات الأداء للوحة التحكم (مفلترة بالدور وتاريخ الإنشاء) |

*مع فلترة حسب الدور: يرى ADMIN و CLAIMS_OFFICER إحصائيات المؤسسة بالكامل وأحمال المعاينين، بينما يرى FIELD_ADJUSTER فقط إحصائيات المطالبات المعينة له وسعته التشغيلية.

---

### 👥 المستخدمون والمفتشون (Users Management)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/users/adjusters?status=available` | CLAIMS_OFFICER / ADMIN | قائمة المفتشين وحمل العمل (متاح إذا المطالبات $\le 3$) |
| `POST` | `/users` | ADMIN | إنشاء حساب موظف جديد (`CLAIMS_OFFICER` أو `FIELD_ADJUSTER`) |
| `GET` | `/users` | ADMIN | عرض جدول موظفي المؤسسة مع الترقيم والفلترة |
| `PATCH` | `/users/:userId/status` | ADMIN | تفعيل أو تعطيل حساب موظف (`ACTIVE` / `INACTIVE`) |
| `PATCH` | `/users/:userId/reset-password` | ADMIN | إعادة تعيين كلمة مرور موظف إداريًا |

---

### 🚗 المركبات والوثائق (Vehicles & Policies)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/vehicles/lookup?plateNumber=ABC-1234` | FIELD_ADJUSTER | البحث برقم اللوحة (مركبة، وثيقة، عميل، تنبيه الانتهاء) |

---

### 🏥 Health Check

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/health` | الكل | التحقق من أن السيرفر وقاعدة البيانات تعمل |

---

## 🧩 شرح طبقات المشروع (Architecture Layers)

المشروع مبني على نمط **3-Layer Architecture**:

```
HTTP Request
    ↓
[Routes]         — يحدد الـ endpoint والـ middleware المطلوب
    ↓
[Controller]     — يستقبل الطلب، يُرسله للـ Service، يُرجع الرد
    ↓
[Service]        — منطق الأعمال (Business Logic): القواعد والتحققات
    ↓
[Repository]     — التعامل مع قاعدة البيانات (MongoDB queries)
    ↓
[Model]          — تعريف شكل البيانات في قاعدة البيانات
```

### مثال عملي: إنشاء مطالبة

```
1. POST /api/v1/claims يصل للـ Router
2. auth.middleware  يتحقق من الـ JWT ويستخرج بيانات المستخدم
3. role.middleware  يتحقق أن الدور هو CLAIMS_OFFICER
4. claim.controller  يُرسل البيانات للـ Service
5. claim.service:
   - يضع organizationId و createdBy من الـ JWT (ليس من الطلب)
   - يُنشئ حدث في الـ Timeline: "Claim Created"
6. claim.repository  يُخزن المطالبة في MongoDB
7. يُرجع رد 201 مع رقم المطالبة
```

---

## 🗄️ نماذج قاعدة البيانات (Data Models)

### Organization (المؤسسة)

```
Organization {
  name: String          ← اسم شركة التأمين
  code: String (unique) ← كود مميز مثل "DEMO-INS"
}
```

### User (المستخدم)

```
User {
  name: String
  employeeCode: String  ← كود الموظف (مثل "FA-001")
  password: String      ← مُشفَّر بـ bcrypt
  role: Enum            ← ADMIN | CLAIMS_OFFICER | FIELD_ADJUSTER
  organizationId: ObjectId → Organization
  status: Enum          ← ACTIVE | INACTIVE
}
```

### Claim (المطالبة) — أهم نموذج

```
Claim {
  claimNumber: String   ← يُوَلَّد تلقائيًا لكل مؤسسة (CLM-<ORG_CODE>-0001...)
  organizationId: ObjectId → Organization
  createdBy: ObjectId → User
  status: Enum          ← NEW | ASSIGNED | IN_PROGRESS | SUBMITTED | UNDER_REVIEW | CORRECTION_REQUIRED | APPROVED | REJECTED | CLOSED

  customer: {           ← بيانات العميل عند فتح الملف
    name: String
    phone: String
  }

  incidentType: Enum    ← COLLISION | REAR_END_COLLISION | SIDE_IMPACT | PARKING_DAMAGE | OTHER
  incidentLocation: String

  vehicle: {            ← يبدأ برقم اللوحة فقط، يكتمل أثناء الفحص
    plateNumber: String
    vehicleId: ObjectId → Vehicle
    policyId: ObjectId → Policy
    customerId: ObjectId → Customer
  }

  assignedTo: ObjectId → User    ← المفتش المُعيَّن
  assignedBy: ObjectId → User    ← الموظف الذي عيّن
  assignedAt: Date
  priority: Enum        ← LOW | MEDIUM | HIGH
  assignmentNotes: String

  accident: {           ← يُملأ من المفتش الميداني أثناء المعاينة
    accidentType: Enum
    accidentDate: String
    accidentTime: String
    description: String
    damageDescription: String
  }

  location: {           ← إحداثيات GPS ملتقطة من المفتش
    latitude: Number
    longitude: Number
    address: String
    capturedAt: Date
  }

  decisionNotes: String ← أسباب قرار الاعتماد أو الرفض

  closedBy: ObjectId → User
  closedAt: Date
  closingNotes: String

  timeline: [{          ← سجل تدقيق تاريخي متكامل لكل حدث
    action: String      ← مثل "Claim Created", "Inspection Started", "Correction Requested"
    previousStatus: String
    newStatus: String
    notes: String
    performedBy: ObjectId → User
    role: String
    timestamp: Date
  }]
}
```

### Vehicle (المركبة)

```
Vehicle {
  plateNumber: String
  make: String          ← الماركة (مثل Toyota)
  model: String         ← الموديل (مثل Camry)
  year: Number
  color: String
  customerId: ObjectId → Customer
  policyId: ObjectId → Policy
  organizationId: ObjectId → Organization
}
```

### Customer (العميل)

```
Customer {
  fullName: String
  phone: String
  organizationId: ObjectId → Organization
}
```

### Policy (وثيقة التأمين)

```
Policy {
  policyNumber: String
  status: Enum          ← ACTIVE | EXPIRED | CANCELLED
  startDate: Date
  expiryDate: Date
  organizationId: ObjectId → Organization
}
```

---

## 🔒 قواعد الأمان والتشغيل المُطبَّقة

### 1. توليد رقم المطالبة تلقائيًا بمعزل المؤسسة
```
CLM-DEMO-0001, CLM-DEMO-0002...
```
يُستخدم عداد ذري معزول لكل مؤسسة (`claimNumber_<organizationId>`) لضمان التسلسل وعدم التكرار.

### 2. عزل البيانات الصارم بين المؤسسات (Multi-Tenancy)
كل استعلام وقراءة وكتابة في قاعدة البيانات تشترط `organizationId` المستخرج حصرًا من الـ JWT token. محاولة الوصول لبيانات مؤسسة أخرى تُرجع فورًا `404 Not Found` لمنع استكشاف الموارد.

### 3. التحقق الذكي من سعة وتوفر المفتش
قبل التعيين، يفحص النظام المفتشين عبر استعلام تجميعي مفرد (`$lookup`):
- هل المفتش نشط (`status: ACTIVE`)؟
- عدد مهامه النشطة في الحالات (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`):
  - $\le 3$ مهام نشطة ← متاح (`AVAILABLE`) ويقبل التعيين.
  - $> 3$ مهام نشطة ← غير متاح (`UNAVAILABLE`) ويُرفض التعيين بـ `409 Conflict`.

### 4. الـ Timeline (سجل التدقيق التاريخي)
كل عملية في المطالبة تُسجَّل تلقائيًا مع:
- من قام بالعملية؟ وما دوره؟
- الحالة السابقة والحالة الجديدة
- الملاحظات أو الأسباب المدخلة (مثل أسباب طلب التصحيح)
- التاريخ والوقت بدقة UTC

### 5. تحذير انتهاء وثيقة التأمين
عند البحث عن مركبة بلوحتها، إذا كانت الوثيقة `EXPIRED`:
```json
"warning": {
  "code": "POLICY_EXPIRED",
  "details": "This policy has expired. Flag this claim for review."
}
```
الفحص يستمر ولكن الملف يُعلَّم للمراجعة.

### 6. الحماية المتقدمة وتحديد معدل الطلبات (Rate Limiting)
- `loginLimiter`: حماية endpoint الدخول ضد هجمات التخمين (Brute-force) بحد 5 محاولات لكل 15 دقيقة لكل IP.
- `apiLimiter`: حماية شاملة للـ API من هجمات الحرمان من الخدمة (DoS).

---

## 🔄 سير العمل الكامل (End-to-End Flow)

### السيناريو: حادث سيارة مكتمل الدورة

```
1. العميل يتصل بشركة التأمين
   └── موظف المطالبات يفتح ملفًا في النظام
       └── POST /claims → status: NEW (رقم المطالبة CLM-DEMO-0001)

2. الموظف يبحث عن مفتش متاح ويعينه
   ├── GET /users/adjusters?status=available (يفحص المعاينين بـ <= 3 مهام)
   └── POST /claims/:id/assign → status: ASSIGNED

3. المفتش الميداني يفتح التطبيق ويبدأ المعاينة
   └── POST /claims/:id/inspection/start → status: IN_PROGRESS

4. المفتش يجمع البيانات الميدانية ويحفظ المسودات
   ├── يبحث برقم اللوحة: GET /vehicles/lookup?plateNumber=ABC-1234
   ├── يربط المركبة والوثيقة والعميل: PUT /claims/:id/vehicle
   ├── يُسجّل تفاصيل وأضرار الحادث: PUT /claims/:id/accident
   ├── يُسجّل إحداثيات الـ GPS: PUT /claims/:id/location
   ├── يرفع صور الأدلة مصنفة: POST /claims/:id/evidence
   └── يلتقط التوقيع الرقمي للمعاينة: POST /claims/:id/signature

5. المفتش يُرسل تقرير الفحص
   └── POST /claims/:id/inspection/submit
       النظام يتحقق من اكتمال الأركان الخمسة (مركبة، حادث، موقع، صور الأدلة، توقيع رقمي)
       → status: SUBMITTED

6. موظف المطالبات يراجع التقرير
   └── POST /claims/:id/review/start → status: UNDER_REVIEW

7. [اختياري] حلقة طلب التصحيح
   ├── الموظف يطلب تعديلات: POST /claims/:id/review/request-correction → CORRECTION_REQUIRED
   ├── المفتش يستأنف المعاينة: POST /claims/:id/inspection/start → IN_PROGRESS
   └── المفتش يعدل ويعيد الإرسال: POST /claims/:id/inspection/submit → SUBMITTED

8. اتخاذ القرار النهائي
   └── POST /claims/:id/decision → status: APPROVED (أو REJECTED)

9. إغلاق وأرشفة الملف
   └── POST /claims/:id/close (خاص بالمدير ADMIN فقط) → status: CLOSED

10. متابعة مؤشرات الأداء والعبء التشغيلي
    └── GET /claims/stats?from=2026-01-01&to=2026-12-31
        ├── لوحة تحكم الإدارة: إجمالي المطالبات، طابور المراجعة، وتوزيع أحمال المفتشين
        └── تطبيق المعاين: الحالات النشطة، المهام المعلقة، وشريط السعة الاستيعابية (الحد الأقصى 3)
```

---

## ✅ ما تم إنجازه في المشروع (Sprint 1 & Sprint 2) — 100% مكتمل ومختبر

### ✅ البنية التحتية والأمان (Infrastructure & Security)
- [x] إعداد Express 5 + Node.js + Mongoose 9
- [x] نظام متغيرات بيئة محكم مع تحقق إلزامي عند الإقلاع (Fail-fast)
- [x] نمط الطبقات الخمس (Routes → Controller → Service → Repository → Model)
- [x] Helmet و Morgan ومعالج مركزي للأخطاء ومعالج 404 وتنسيق ردود موحد
- [x] حماية مزدوجة بـ Rate Limiting (`loginLimiter` و `apiLimiter`)
- [x] دعم الترقيم بالهيدرز (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`)

### ✅ المصادقة والمستخدمين (Auth & RBAC)
- [x] تسجيل الدخول بكود المؤسسة + كود الموظف + كلمة المرور
- [x] توليد JWT لـ 8 ساعات ودعم استخراجه من الـ Header والـ Cookie
- [x] تشفير bcrypt وميزة تغيير كلمة المرور الذاتية
- [x] إدارة الموظفين للمدير (`POST /users`, `GET /users`, `status`, `reset-password`)
- [x] التحقق من سعة المعاينين عبر Aggregation بحد أقصى 3 مهام نشطة

### ✅ إدارة المطالبات وآلة الحالات (Claims & 9-Status State Machine)
- [x] إنشاء المطالبات مع ترقيم تسلسلي معزول للمؤسسة (`CLM-<ORG>-0001`)
- [x] تعيين المفتش مع حماية تعارض التزامن الذرية (Atomic 409 Conflict)
- [x] بدء واستئناف المعاينة الميدانية والانتقال لـ `IN_PROGRESS`
- [x] فحص المركبة والوثيقة مع تنبيه انتهاء الوثيقة
- [x] حفظ مسودات المعاينة (مركبة، حادث، موقع GPS)
- [x] رفع صور الأدلة الميدانية والتوقيع الرقمي إلى Cloudinary مع عزل كامل لكل شركة تأمين
- [x] إرسال التقرير مع تحقق إلزامي من الأركان الخمسة (422 Unprocessable Entity)
- [x] بدء تدقيق المراجعة من موظف المطالبات (`UNDER_REVIEW`)
- [x] حلقة طلب التصحيح مع الملاحظات الإلزامية (`CORRECTION_REQUIRED`)
- [x] محرك القرارات بالاعتماد أو الرفض (`APPROVED` / `REJECTED`)
- [x] إغلاق وأرشفة المطالبة من قِبل المدير (`CLOSED`)
- [x] تجميع مؤشرات الأداء (KPIs) للوحة التحكم عبر Aggregation ذري وفهارس مركبة (`GET /claims/stats`)
- [x] سجل تدقيق تاريخي ذري وشامل (Timeline) يوثق كل حالة وملاحظة ومستخدم

### ✅ الاختبارات والتوثيق المعتمد
- [x] اجتياز 100% من الاختبارات التلقائية (18 Test Suites / 241 Tests Passed)
- [x] عقد واجهات الـ API الكامل (`docs/API_CONTRACT.md`)
- [x] دليل ربط واجهات المدير للفرونت إند (`docs/ADMIN_API_FOR_FRONTEND.md`)
- [x] مجموعة Postman الشاملة لجميع العمليات (`InsurFlow.postman_collection.json`)
- [x] وثائق تفصيلية لجميع الميزات الـ 16 في مجلد `docs/features/`

---

## 🔮 خارطة العمل المستقبلية (Sprint 3 القادم)

- [x] رفع وتخزين الصور والأدلة عالية الدقة على السحابة (تم تنفيذه عبر Cloudinary مع عزل مسارات المستأجرين)
- [x] جمع التوقيع الرقمي للمفتش والعميل وتخزينه سحابيًا (Digital Signatures)
- [ ] نظام الإشعارات اللحظية (Push Notifications / WebSockets)
- [ ] التكامل مع ورش الصيانة وتقديرات التكاليف وبوابات الصرف البنكية

---

## 📦 البيانات التجريبية الجاهزة

بعد تشغيل `seedMockData.js`، تجد هذه البيانات في قاعدة البيانات:

| النوع | البيانات |
|-------|---------|
| مؤسسة | `Demo Insurance Co` — كود: `DEMO-INS` |
| عميل 1 | John Doe — هاتف: +1234567890 |
| عميل 2 | Jane Smith — هاتف: +1987654321 |
| وثيقة 1 | `POL-1000` — حالة: **ACTIVE** — تنتهي: 2026-12-31 |
| وثيقة 2 | `POL-2000` — حالة: **EXPIRED** — انتهت: 2023-12-31 |
| سيارة 1 | `ABC-1234` — Toyota Camry 2022 (لوثيقة سارية) |
| سيارة 2 | `XYZ-9876` — Honda Civic 2019 (لوثيقة منتهية) |

---

## 📝 قراءة الـ API Contract

للمزيد من التفاصيل عن كل endpoint، راجع ملف [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

---

## 👨‍💻 للمطورين الجدد على المشروع

### أول شيء افهمه: الـ Multi-Tenancy
كل بيانات في النظام مربوطة بـ `organizationId`. هذا يعني أن نفس السيرفر يخدم شركات تأمين متعددة.

### ثاني شيء: الـ JWT Payload
المستخدم لا يُرسل `organizationId` في الطلب. النظام يستخرجه من الـ token. إذا رأيت `authUser.organizationId` في الكود، هذا يأتي من الـ JWT.

### ثالث شيء: الـ Timeline
كل عملية تُسجَّل في مصفوفة `timeline` داخل المطالبة. هذا يعطيك تاريخ كامل لمن فعل ماذا ومتى.

### رابع شيء: Repository Pattern
لا تُكتب MongoDB queries مباشرة في الـ Service. كل التعامل مع قاعدة البيانات يمر عبر Repository. هذا يجعل الكود قابلًا للاختبار والتعديل.
