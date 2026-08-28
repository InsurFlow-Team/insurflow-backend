# 🛡️ InsurFlow — Backend API (Sprint 1)

> **نظام إدارة مطالبات التأمين على المركبات**  
> A multi-tenant insurance claims management backend built with Node.js, Express, and MongoDB.

---

## 📖 ما هو InsurFlow؟

InsurFlow هو نظام إدارة مطالبات التأمين على السيارات. الفكرة الأساسية هي أن شركات التأمين تستخدم هذا النظام لإدارة عملية تسوية الحوادث من البداية للنهاية.

**المشكلة التي يحلها:**  
عند وقوع حادث سيارة، يحتاج العميل إلى تقديم مطالبة تأمينية. هذا النظام يُنظّم العملية كاملة:
1. موظف المطالبات يفتح الملف
2. يُعيّن مفتش ميداني يذهب لمكان الحادث
3. المفتش يجمع كل البيانات (السيارة، الحادث، الموقع)
4. المفتش يُرسل تقرير الفحص
5. الموظف يراجع ويوافق
6. الإدارة تُغلق الملف نهائيًا

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
│   │   └── database.js           ← الاتصال بـ MongoDB
│   │
│   ├── middlewares/              ← وسطاء الطلبات (تُنفَّذ قبل كل endpoint)
│   │   ├── auth.middleware.js    ← التحقق من الـ JWT token
│   │   ├── role.middleware.js    ← التحقق من صلاحية الدور
│   │   ├── errorHandler.js       ← معالج الأخطاء العام
│   │   └── notFound.js           ← معالج الـ 404
│   │
│   ├── utils/                    ← أدوات مساعدة عامة
│   │   ├── apiResponse.js        ← تنسيق موحد للردود
│   │   ├── appError.js           ← كلاس مخصص للأخطاء
│   │   └── counter.model.js      ← عداد لتوليد أرقام المطالبات
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
├── tests/                        ← الاختبارات التلقائية
│   ├── auth.test.js
│   ├── claim.lifecycle.test.js
│   ├── claim.assignment.test.js
│   ├── claim.inspection.test.js
│   ├── claim.read.test.js
│   ├── user.adjuster.test.js
│   ├── vehicle.lookup.test.js
│   └── middleware.test.js
│
├── docs/
│   └── API_CONTRACT.md           ← عقد الـ API مع فرق الـ Frontend والـ Mobile
│
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
cd INSURFLOW

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
MONGODB_URI=mongodb://localhost:27017/insurflow
JWT_SECRET=your-super-secret-key-here
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

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
| `CLAIMS_OFFICER` | إنشاء مطالبة، تعيين مفتش، بدء المراجعة |
| `FIELD_ADJUSTER` | عرض المطالبات المُعيّنة له، تنفيذ الفحص، إرسال التقرير |
| `ADMIN` | إغلاق المطالبة نهائيًا |

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

هذا هو قلب النظام. المطالبة تمر بهذه المراحل بالترتيب:

```
NEW → ASSIGNED → SUBMITTED → UNDER_REVIEW → APPROVED → CLOSED
```

### شرح كل مرحلة:

```
1. NEW
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims
   └── ماذا يحدث: يُنشئ ملف المطالبة بالمعلومات الأساسية

2. ASSIGNED  
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims/:id/assign
   └── ماذا يحدث: يُعيّن مفتشًا ميدانيًا متاحًا للمطالبة

3. SUBMITTED
   ├── من يفعلها: FIELD_ADJUSTER
   ├── كيف: POST /api/v1/claims/:id/inspection/submit
   └── ماذا يحدث: المفتش يُرسل التقرير بعد إكمال الفحص

4. UNDER_REVIEW
   ├── من يفعلها: CLAIMS_OFFICER
   ├── كيف: POST /api/v1/claims/:id/review/start
   └── ماذا يحدث: الموظف يبدأ مراجعة تقرير المفتش

5. APPROVED
   ├── من يفعلها: CLAIMS_OFFICER (مخطط — لم يُنفَّذ في Sprint 1)
   ├── كيف: POST /api/v1/claims/:id/decision
   └── ماذا يحدث: الموظف يُقرر الموافقة على المطالبة

6. CLOSED
   ├── من يفعلها: ADMIN (مخطط — لم يُنفَّذ في Sprint 1)
   ├── كيف: POST /api/v1/claims/:id/close
   └── ماذا يحدث: الإدارة تُغلق الملف نهائيًا
```

> **ملاحظة:** المراحل 5 و6 مُخططة في الـ API Contract لكن تنفيذها في Sprint التالي.

---

## 📡 API Endpoints — جميع الـ Endpoints المُنفَّذة

**Base URL:** `http://localhost:3000/api/v1`

### 🔐 المصادقة

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `POST` | `/auth/login` | الكل | تسجيل الدخول والحصول على JWT |

**مثال طلب تسجيل الدخول:**
```json
POST /api/v1/auth/login
{
  "organizationCode": "DEMO-INS",
  "employeeCode": "CO-001",
  "password": "password123"
}
```

---

### 📋 المطالبات (Claims)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `POST` | `/claims` | CLAIMS_OFFICER | إنشاء مطالبة جديدة |
| `GET` | `/claims` | الكل* | عرض قائمة المطالبات |
| `GET` | `/claims/:claimId` | الكل* | عرض تفاصيل مطالبة واحدة |
| `POST` | `/claims/:claimId/assign` | CLAIMS_OFFICER | تعيين مفتش للمطالبة |
| `PUT` | `/claims/:claimId/vehicle` | FIELD_ADJUSTER | تحديث بيانات المركبة |
| `PUT` | `/claims/:claimId/accident` | FIELD_ADJUSTER | تحديث تفاصيل الحادث |
| `PUT` | `/claims/:claimId/location` | FIELD_ADJUSTER | تحديث موقع الحادث |
| `POST` | `/claims/:claimId/inspection/submit` | FIELD_ADJUSTER | إرسال تقرير الفحص |
| `POST` | `/claims/:claimId/review/start` | CLAIMS_OFFICER | بدء مراجعة التقرير |

*مع فلترة حسب الدور: FIELD_ADJUSTER يرى فقط ما عُيّن له.

---

### 👥 المستخدمون (Users)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/users/adjusters` | CLAIMS_OFFICER | قائمة المفتشين مع حالة التوفر |

**الاستعلام الاختياري:** `?status=available` — يُرجع المفتشين المتاحين فقط

---

### 🚗 المركبات (Vehicles)

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/vehicles/lookup?plateNumber=ABC-1234` | FIELD_ADJUSTER | البحث عن مركبة برقم اللوحة |

---

### 🏥 Health Check

| Method | Endpoint | من يستخدمه | الوصف |
|--------|----------|-----------|-------|
| `GET` | `/health` | الكل | التحقق من أن السيرفر يعمل |

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
  claimNumber: String   ← يُوَلَّد تلقائيًا (CLM-0001, CLM-0002...)
  organizationId: ObjectId → Organization
  createdBy: ObjectId → User
  status: Enum          ← NEW | ASSIGNED | SUBMITTED | UNDER_REVIEW | APPROVED | CLOSED

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

  accident: {           ← يُملأ من المفتش الميداني
    accidentType: Enum
    accidentDate: String
    accidentTime: String
    description: String
    damageDescription: String
  }

  location: {           ← إحداثيات GPS من المفتش
    latitude: Number
    longitude: Number
    address: String
    capturedAt: Date
  }

  closedBy: ObjectId → User
  closedAt: Date
  closingNotes: String

  timeline: [{          ← سجل تاريخي لكل حدث
    action: String      ← مثل "Claim Created", "Claim Assigned"
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

## 🔒 قواعد الأمان المُطبَّقة

### 1. توليد رقم المطالبة تلقائيًا
```
CLM-0001, CLM-0002, CLM-0003...
```
يُستخدم MongoDB Counter لضمان عدم التكرار.

### 2. عزل البيانات بين المؤسسات
كل query في قاعدة البيانات تشترط `organizationId`. لا يُمكن لموظف في شركة A رؤية بيانات شركة B.

### 3. التحقق من توفر المفتش
قبل التعيين، النظام يتحقق:
- هل المفتش نشط (`status: ACTIVE`)؟
- هل لديه مطالبة مُعيَّنة بالفعل؟ إذا نعم → `ADJUSTER_UNAVAILABLE`

### 4. الـ Timeline (سجل الأحداث)
كل تغيير في المطالبة يُسجَّل تلقائيًا مع:
- من قام به؟
- ما هو دوره؟
- متى؟

### 5. تحذير انتهاء وثيقة التأمين
عند البحث عن مركبة بلوحتها، إذا كانت الوثيقة `EXPIRED`:
```json
"warning": {
  "code": "POLICY_EXPIRED",
  "details": "This policy has expired. Flag this claim for review."
}
```
الفحص يستمر ولكن الملف يُعلَّم للمراجعة.

---

## 🔄 سير العمل الكامل (End-to-End Flow)

### السيناريو: حادث سيارة

```
1. العميل يتصل بشركة التأمين
   └── موظف المطالبات يفتح ملفًا في النظام
       └── POST /claims → status: NEW

2. الموظف يبحث عن مفتش متاح
   └── GET /users/adjusters?status=available

3. الموظف يُعيّن المفتش
   └── POST /claims/:id/assign → status: ASSIGNED

4. المفتش الميداني يذهب لمكان الحادث
   │
   ├── يبحث عن السيارة برقم اللوحة
   │   └── GET /vehicles/lookup?plateNumber=ABC-1234
   │       (يُرجع بيانات السيارة والعميل والوثيقة)
   │
   ├── يُحدّث بيانات السيارة على الملف
   │   └── PUT /claims/:id/vehicle
   │
   ├── يُسجّل تفاصيل الحادث
   │   └── PUT /claims/:id/accident
   │
   └── يُسجّل موقع GPS
       └── PUT /claims/:id/location

5. المفتش يُرسل التقرير
   └── POST /claims/:id/inspection/submit
       النظام يتحقق: هل كل البيانات مكتملة؟
       ✓ السيارة | ✓ الحادث | ✓ الموقع
       → status: SUBMITTED

6. موظف المطالبات يبدأ المراجعة
   └── POST /claims/:id/review/start → status: UNDER_REVIEW

7. [Sprint التالي] الموافقة والإغلاق
   ├── POST /claims/:id/decision → status: APPROVED
   └── POST /claims/:id/close → status: CLOSED
```

---

## ✅ ما تم إنجازه في Sprint 1

### ✅ البنية التحتية (Infrastructure)
- [x] إعداد المشروع بـ Node.js + Express
- [x] الاتصال بـ MongoDB عبر Mongoose
- [x] نظام متغيرات البيئة (.env)
- [x] نمط المعماريات الثلاث (Routes → Controller → Service → Repository → Model)
- [x] Helmet للأمان
- [x] Morgan لتسجيل الطلبات
- [x] معالج عام للأخطاء
- [x] معالج 404
- [x] تنسيق موحد لكل الردود (`successResponse` / `errorResponse`)

### ✅ المصادقة (Authentication)
- [x] تسجيل الدخول بثلاثة عناصر: كود المؤسسة + كود الموظف + كلمة المرور
- [x] توليد JWT يصلح لـ 8 ساعات
- [x] middleware للتحقق من الـ JWT في كل طلب محمي
- [x] middleware للتحقق من الدور (RBAC)
- [x] تشفير كلمات المرور بـ bcrypt

### ✅ إدارة المطالبات (Claims Management)
- [x] إنشاء مطالبة جديدة (CLAIMS_OFFICER فقط)
- [x] توليد رقم تسلسلي تلقائي (CLM-0001...)
- [x] عرض قائمة المطالبات مع فلترة حسب الدور
- [x] عرض تفاصيل مطالبة واحدة
- [x] نظام Audit Timeline (تسجيل كل حدث)

### ✅ تعيين المفتشين (Adjuster Assignment)
- [x] عرض قائمة المفتشين مع حالة التوفر الحقيقية
- [x] التعيين مع التحقق من: وجود المطالبة، حالتها NEW، نشاط المفتش، عدم انشغاله
- [x] تسجيل من عيّن ومتى

### ✅ فحص ميداني (Field Inspection)
- [x] البحث عن مركبة برقم اللوحة
- [x] ربط المركبة + الوثيقة + العميل بالمطالبة
- [x] تسجيل تفاصيل الحادث
- [x] تسجيل الموقع الجغرافي (GPS)
- [x] إرسال التقرير مع التحقق من اكتمال البيانات
- [x] تحذير انتهاء الوثيقة

### ✅ بدء المراجعة
- [x] انتقال الحالة من SUBMITTED → UNDER_REVIEW

### ✅ الاختبارات التلقائية (Automated Tests)
- [x] اختبارات المصادقة (`auth.test.js`)
- [x] اختبارات دورة حياة المطالبة (`claim.lifecycle.test.js`)
- [x] اختبارات التعيين (`claim.assignment.test.js`)
- [x] اختبارات الفحص الميداني (`claim.inspection.test.js`)
- [x] اختبارات القراءة (`claim.read.test.js`)
- [x] اختبارات المفتشين (`user.adjuster.test.js`)
- [x] اختبارات البحث عن المركبات (`vehicle.lookup.test.js`)
- [x] اختبارات الـ Middleware (`middleware.test.js`)

### ✅ التوثيق (Documentation)
- [x] API Contract كامل (`docs/API_CONTRACT.md`)
- [x] سكريبت بيانات تجريبية (`seedMockData.js`)

---

## ❌ ما لم يُنفَّذ بعد (Sprint التالي)

- [ ] `POST /claims/:id/decision` — قرار الموافقة/الرفض
- [ ] `POST /claims/:id/close` — إغلاق الملف من الإدارة
- [ ] رفع الصور والأدلة (Evidence)
- [ ] التوقيع الرقمي (Digital Signature)
- [ ] نظام الإشعارات

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

---

*وثّقه: Antigravity AI — Sprint 1 Documentation*
