# دليل واجهات وبرمجة دور المدير للفرونت إند (Admin API Documentation for Frontend)

يقدم هذا التوثيق مرجعاً كاملاً لمطور الواجهة الأمامية (**Frontend Developer**) لربط جميع واجهات ووظائف المدير (**ADMIN**) في منصة **InsurFlow**.

> 📄 **وثيقة تسليم ومواءمة الفرونت إند:** يرجى مراجعة [وثيقة تسليم الفرونت إند (Frontend Handoff)](./FRONTEND_HANDOFF.md) للاطلاع على أحدث مواصفات شاشات التحقق وفتح المطالبات، التتبع العام، وقواعد اتخاذ القرار.

---

## 📌 معلومات أساسية للمطور (Core Information)

* **Base URL DEV:** `http://localhost:3000/api/v1` 
* **Base URL PROD:** `https://insurflow-backend.onrender.com/api/v1` 
* **Headers الإجبارية لجميع الطلبات المحمية:**
  ```http
  Authorization: Bearer <ACCESS_TOKEN>
  Content-Type: application/json
  ```
* **تحديد دور المستخدم (Role Identification):**
  عند تسجيل الدخول، يرجع كائن `data.user` وفيه:
  `role: "ADMIN"` -> يتم بناءً عليه فتح صلاحيات صفحات ولوحة تحكم المدير.

---

## 1. المصادقة وإدارة الحساب الشخصي (Authentication)

### 1.1 تسجيل دخول المدير (Admin Login)
* **المسار (Endpoint):** `POST /api/v1/auth/login`
* **الهدف:** مصادقة المدير واستلام الـ `accessToken`.
* **Headers:** `Content-Type: application/json`
* **Request Body:**
  ```json
  {
    "organizationCode": "DEMO-INS",
    "employeeCode": "AD-001",
    "password": "Password123!"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "accessToken": "eyJhbGciOi...",
      "user": {
        "id": "6aa27838cda4d3dca00b83ab",
        "name": "Admin User",
        "employeeCode": "AD-001",
        "role": "ADMIN",
        "organizationId": "6a919f45e62778a597174333",
        "organizationName": "Demo Insurance Co"
      }
    }
  }
  ```
* **إجراءات الفرونت:**
  1. حفظ `accessToken` في الـ State أو Storage أو الذاكرة.
  2. توجيه المستخدم لصفحة المدير إذا كان `role === "ADMIN"`.

---

### 1.2 تغيير كلمة المرور الخاصة بالمدير (Change Own Password)
* **المسار (Endpoint):** `PUT /api/v1/auth/change-password`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **المكان في الواجهة:** الملف الشخصي للمدير (Profile / Settings).
* **Request Body:**
  ```json
  {
    "currentPassword": "Password123!",
    "newPassword": "NewStrongAdminPassword2026!"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password changed successfully",
    "data": {
      "message": "Password changed successfully"
    }
  }
  ```
* **أخطاء محتملة:**
  * `401 Unauthorized`: كلمة المرور الحالية غير صحيحة (`INVALID_CREDENTIALS`).
  * `400 Bad Request`: كلمة المرور الجديدة مطابقة للقديمة أو أقل من 8 خانات.

---

### 1.3 تسجيل وتحديث رمز جهاز الإشعارات (Register / Update Device FCM Token)
* **المسار (Endpoint):** `PATCH /api/v1/users/me/fcm-token`
* **Headers:** `Authorization: Bearer <ACCESS_TOKEN>`
* **الوصف:** متاح لجميع الأدوار لتسجيل رمز الـ FCM لاستقبال إشعارات النظام الفورية.
* **Request Body:**
  ```json
  {
    "fcmToken": "c7x_sample_device_fcm_token_string"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Device token updated successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ab",
      "fcmToken": "c7x_sample_device_fcm_token_string"
    }
  }
  ```

---

## 2. إدارة الموظفين والمستخدمين (User Management) — *خاص بالمدير*

### 2.1 استعراض جدول الموظفين (List Organization Users)
* **المسار (Endpoint):** `GET /api/v1/users?page=1&limit=10&role=FIELD_ADJUSTER`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **Query Parameters (اختيارية):**
  * `page` (default: 1): رقم الصفحة
  * `limit` (default: 50, max: 100): عدد النتائج في الصفحة
  * `role`: فلترة الموظفين حسب الدور (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Success",
    "data": {
      "users": [
        {
          "id": "6aa27838cda4d3dca00b83ac",
          "name": "Sara Officer",
          "employeeCode": "CO-001",
          "role": "CLAIMS_OFFICER",
          "status": "ACTIVE",
          "createdAt": "2026-09-10T09:28:24.020Z"
        },
        {
          "id": "6aa27838cda4d3dca00b83ad",
          "name": "Ahmed Adjuster",
          "employeeCode": "FA-001",
          "role": "FIELD_ADJUSTER",
          "status": "ACTIVE",
          "createdAt": "2026-09-10T09:28:24.020Z"
        }
      ],
      "pagination": {
        "totalCount": 2,
        "page": 1,
        "limit": 10,
        "totalPages": 1
      }
    }
  }
  ```

---

### 2.2 إنشاء موظف جديد (Create New User)
* **المسار (Endpoint):** `POST /api/v1/users`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **المكان في الواجهة:** زر "إضافة موظف جديد" داخل نافذة Modal.
* **الأدوار المسموح للمدير إنشاؤها:** `CLAIMS_OFFICER` أو `FIELD_ADJUSTER`.
* **Request Body:**
  ```json
  {
    "name": "محمد خبير ميداني",
    "employeeCode": "FA-105",
    "password": "Password123!",
    "role": "FIELD_ADJUSTER"
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ee",
      "name": "محمد خبير ميداني",
      "employeeCode": "FA-105",
      "role": "FIELD_ADJUSTER",
      "status": "ACTIVE",
      "createdAt": "2026-09-10T10:15:00.000Z"
    }
  }
  ```
* **أخطاء محتملة:**
  * كود الموظف مستخدم سابقاً: `409 Conflict` (`EMPLOYEE_CODE_TAKEN`).
  * كلمة المرور أقل من 8 خانات: `400 Bad Request` (`VALIDATION_ERROR`).

---

### 2.3 تعديل بيانات موظف (Update User Details)
* **المسار (Endpoint):** `PATCH /api/v1/users/:userId`
* **Headers:** 
  ```http
  Authorization: Bearer <ADMIN_TOKEN>
  Content-Type: application/json
  ```
* **المكان في الواجهة:** زر "تعديل" (Edit) بجانب الموظف في جدول إدارة الموظفين، يفتح نافذة Modal لتعديل الاسم و/أو كود الموظف.
* **Request Body:**
  ```json
  {
    "name": "الاسم الجديد",
    "employeeCode": "FA-003"
  }
  ```
  *(ملاحظة: كلا الحقلين اختياري ولكن يجب إرسال حقل واحد على الأقل، وأي حقول غير مصرح بها مثل `role` أو `password` سيتم رفضها بـ `400 Bad Request`).*
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "User updated successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ee",
      "name": "الاسم الجديد",
      "employeeCode": "FA-003",
      "role": "FIELD_ADJUSTER",
      "status": "ACTIVE",
      "createdAt": "2026-09-10T10:15:00.000Z",
      "updatedAt": "2026-09-12T12:40:00.000Z"
    }
  }
  ```
* **أخطاء محتملة:**
  * كود الموظف الجديد مستخدم مسبقاً لدى موظف آخر في نفس الشركة: `409 Conflict` (`EMPLOYEE_CODE_TAKEN`).
  * الموظف غير موجود أو يتبع لشركة أخرى (حماية Multi-tenancy): `404 Not Found` (`USER_NOT_FOUND`).
  * صيغة المعرف `userId` غير صالحة أو الـ Body فارغ: `400 Bad Request` (`VALIDATION_ERROR`).

---

### 2.4 تفعيل أو تعطيل حساب موظف (Toggle User Status)
* **المسار (Endpoint):** `PATCH /api/v1/users/:userId/status`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **المكان في الواجهة:** زر تفعيل/تعطيل بجانب كل موظف في الجدول.
* **Request Body:**
  ```json
  {
    "status": "INACTIVE"
  }
  ```
  *(القيم المتاحة: `"ACTIVE"` أو `"INACTIVE"`)*
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "User status updated successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ee",
      "status": "INACTIVE"
    }
  }
  ```

---

### 2.5 إعادة تعيين كلمة مرور موظف (Admin Reset Password)
* **المسار (Endpoint):** `PATCH /api/v1/users/:userId/reset-password`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **المكان في الواجهة:** نافذة "إعادة تعيين كلمة المرور" عند نسيان الموظف لباسورده (لا يلزم معرفة الباسورد القديم).
* **Request Body:**
  ```json
  {
    "newPassword": "NewTempPassword123!"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password reset successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ee",
      "message": "Password reset successfully"
    }
  }
  ```

---

### 2.6 تسجيل وتحديث توكن الإشعارات للأجهزة المحمولة (Device FCM Token Registration)
* **المسار (Endpoint):** `PATCH /api/v1/users/me/fcm-token`
* **Headers:** `Authorization: Bearer <JWT_TOKEN>` (متاح لجميع الأدوار: `FIELD_ADJUSTER`, `CLAIMS_OFFICER`, `ADMIN`)
* **الوصف:** يقوم بحفظ أو تحديث رمز جهاز المستخدم المستلم من Firebase Cloud Messaging (FCM) في وثيقة المستخدم الخاصة به لاستلام الإشعارات الفورية.
* **Request Body:**
  ```json
  {
    "fcmToken": "dKj4f_...-device-token-string"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Device token updated successfully",
    "data": {
      "id": "6aa27838cda4d3dca00b83ee",
      "fcmToken": "dKj4f_...-device-token-string"
    }
  }
  ```

---

### 2.7 استعراض المعاينين الميدانيين وحمل العمل (Adjusters Workload)
* **المسار (Endpoint):** `GET /api/v1/users/adjusters?status=available`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **Query Parameters:** `status=available` (اختياري لجلب المتفرغين فقط).
* **قاعدة التوفر:** يعتبر المعاين متاحاً (`availability: "AVAILABLE"`) إذا كان حسابه نشطاً ولديه 3 مطالبات نشطة أو أقل (`activeTasksCount <= 3`) في الحالات (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`).
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Success",
    "data": [
      {
        "id": "6aa27838cda4d3dca00b83ad",
        "name": "Ahmed Adjuster",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "AVAILABLE",
        "activeTasksCount": 0,
        "capacityLimit": 3
      }
    ]
  }
  ```

---

## 3. إدارة ومراقبة المطالبات (Claims Operations)

### 3.0 بوابة التحقق المسبق من وثيقة التأمين ولقطة التغطية (Policy Verification & Coverage Snapshot — Feature 20)
* **المسار (Endpoint):** `POST /api/v1/policies/verify`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN or CLAIMS_OFFICER_TOKEN>`
* **الأدوار المصرح لها:** `ADMIN`, `CLAIMS_OFFICER`.
* **المكان وتجربة المستخدم في الواجهة الأمامية (UI Placement & Business Flow):**
  - **الخطوة الإلزامية الأولى قبل إنشاء المطالبة (Pre-Claim Intake Gate):**
    عندما يتصل العميل للإبلاغ عن حادث أو فتح مطالبة، يدخل الموظف في شاشة الـ Intake **رقم وثيقة التأمين (`policyNumber`) أو رقم لوحة السيارة (`plateNumber`) أو كلاهما معاً**، ويمكنه اختيارياً إدخال تاريخ وقوع الحادث (`incidentDate`) ونوع الحادث (`incidentType`).
  - **لقطة التغطية وتلميح الأهلية (Coverage Snapshot & Eligibility Hint):**
    ترجع الواجهة لقطة التغطية التأمينية للمركبة المؤمن عليها (`policyType`, `coveredPerils`, `deductibleAmount`) بالإضافة إلى مؤشر مبكر لأهلية التغطية (`eligibilityHint`):
    * **`ELIGIBLE_FOR_REVIEW` (شارة خضراء):** نوع الحادث مشمول ضمن أخطار الضرر الذاتي للمركبة.
    * **`NOT_COVERED_BY_POLICY_TYPE` (شارة تحذيرية صفراء):** نص الشارة: **"الضرر الذاتي غير مشمول"** (على سبيل المثال: وثيقة ضد الغير `THIRD_PARTY` عند تسجيل حادث اصطدام كضرر ذاتي للمركبة المؤمنة).
    * **`COVERAGE_UNKNOWN` (شارة رمادية استشارية):** وثيقة قديمة غير مرحّلة تفتقر لبيانات التغطية.
    * **`INCIDENT_OUTSIDE_POLICY_PERIOD` (شارة تحذيرية صفراء):** تاريخ الحادث المرجعي يقع خارج فترة سريان الوثيقة (تنبيه استشاري فقط ولا يمنع التحقق أو فتح المطالبة).
    * **`null`:** لم يتم إرسال `incidentType` في الطلب.
  - **مفهوم التغطية التأمينية:**
    * `coveredPerils` تعني حصراً **أخطار الضرر الذاتي للمركبة المؤمنة** (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
    * وثيقة `THIRD_PARTY` تغطي المسؤولية المدنية تجاه الغير وتستثني الضرر الذاتي لمركبة المؤمن له (تكون `coveredPerils` فارغة `[]` ومبلغ التحمل `deductibleAmount` يساوي `0`).
    * ملاحظة: التأمين ضد الغير منفصل تماماً عن التأمين الإلزامي؛ الإلزامي منتج منفصل غير مموّل في النظام حالياً.
  - **إذا كانت الوثيقة ملغاة أو المركبة غير متطابقة:** يرجع الباك إند رسالة خطأ صريحة ويتم منع الانتقال لإنشاء المطالبة (`POST /api/v1/claims`). بينما عدم مطابقة فترة السريان أو عدم تغطية الخطر ينتج شارة استشارية `eligibilityHint` فقط ولا يمنع فتح المطالبة.
  - **إذا كانت الوثيقة صالحة وفعالة:** يرجع الباك إند كائن التأكيد وفيه بيانات الوثيقة والتغطية والسيارة والعميل، ويقوم الفرونت إند بملء حقول العميل والسيارة تلقائياً وتفعيل زر المتابعة لإنشاء المطالبة.
* **Request Body:**
  ```json
  {
    "policyNumber": "POL-1000",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-09-21",
    "incidentType": "COLLISION"
  }
  ```
  *(ملاحظة: يدعم النظام البحث والتحقق برقم الوثيقة أو برقم اللوحة مباشرة `policyNumber` OR `plateNumber`، ويجب إرسال أحدهما على الأقل. بينما `incidentDate` اختياري ويُشترط ألا يكون تاريخاً في المستقبل. و`incidentType` اختياري من القيم: `COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).*
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Policy verified successfully",
    "data": {
      "isEligible": true,
      "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
      "policy": {
        "id": "60d0fe4f5311236168a109d1",
        "policyNumber": "POL-1000",
        "status": "ACTIVE",
        "startDate": "2025-01-01",
        "expiryDate": "2026-12-31",
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT", "FIRE", "NATURAL_DISASTER"],
        "deductibleAmount": 500
      },
      "coverage": {
        "policyType": "COMPREHENSIVE",
        "effectiveFrom": "2025-01-01",
        "effectiveTo": "2026-12-31",
        "deductible": 500,
        "incidents": [
          { "code": "COLLISION", "covered": true },
          { "code": "THEFT", "covered": true },
          { "code": "FIRE", "covered": true },
          { "code": "NATURAL_DISASTER", "covered": true }
        ]
      },
      "vehicle": {
        "id": "60d0fe4f5311236168a109d0",
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2022,
        "color": "White"
      },
      "customer": {
        "id": "60d0fe4f5311236168a109d2",
        "fullName": "Ahmad Ali",
        "phone": "+962791234567"
      }
    }
  }
  ```
  *(ملاحظة خاصة بكائن التغطية `coverage` - GAP-02: يعكس كائن `coverage` التغطية الحقيقية السارية على الحادث المراد التحقق منه. يتضمن نوع الوثيقة `policyType`، وتواريخ السريان `effectiveFrom` و `effectiveTo`، ومبلغ التحمل الإجمالي للوثيقة `deductible`، ومصفوفة `incidents` لجميع الأخطار المعتمدة رسمياً مع حالة تغطية كل خطر `covered: true/false`. في الوثائق القديمة غير المرحلة يرجع `coverage: null`).*
* **الأخطاء المحتملة (Validation & Rejection Rules):**
  * `400 Bad Request`:
    * `VALIDATION_ERROR`: عدم إرسال كل من `policyNumber` و `plateNumber`، أو صيغة تاريخ غير صالحة، أو قيمة `incidentType` غير مطابقة للأنواع المسموحة.
    * `INVALID_INCIDENT_DATE`: تاريخ وقوع الحادث في المستقبل (يمنع النظام فتح مطالبة لحادث لم يقع بعد).
  * `404 Not Found`:
    * `POLICY_NOT_FOUND`: الوثيقة غير مسجلة في الشركة (أو تتبع شركة أخرى - Stealth Tenancy)، أو المركبة لا تملك وثيقة مرتبطة.
    * `VEHICLE_NOT_FOUND`: المركبة غير موجودة باللوحة المدخلة في قاعدة بيانات الشركة.
  * `422 Unprocessable Entity`:
    * `POLICY_CANCELLED`: الوثيقة ملغاة.
    * `VEHICLE_MISMATCH`: رقم اللوحة المدخل لا يطابق المركبة المؤمن عليها، أو لا توجد مركبة مسجلة تحت الوثيقة لمطابقتها.
    * `AMBIGUOUS_VEHICLE_SELECTION`: الوثيقة تضم أكثر من مركبة مسجلة ولم يتم تحديد رقم اللوحة.

---

### 3.0b فتح وتسجيل مطالبة جديدة (Claim Intake & Creation — Feature 03)
* **المسار (Endpoint):** `POST /api/v1/claims`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN or CLAIMS_OFFICER_TOKEN>`
* **الأدوار المصرح لها:** `ADMIN`, `CLAIMS_OFFICER`.
* **Request Body:**
  ```json
  {
    "policyId": "651a2b3c4d5e6f7a8b9c0d1e",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-06-15",
    "incidentType": "COLLISION",
    "incidentLocation": "Main St, Riyadh",
    "description": "Front collision with another vehicle",
    "latitude": 31.9050,
    "longitude": 35.2040
  }
  ```
* **تعليمات صارمة لشكل البيانات في الواجهة:**
  1. **إحداثيات مسطحة Flat Coordinates:** يجب إرسال `latitude` و `longitude` كحقول رقمية مسطحة في أصل كائن الطلب، **وليس كائناً متداخلاً (Nested Object)**.
  2. **تاريخ الحادث إلزامي:** حقل `incidentDate` إلزامي بصيغة `YYYY-MM-DD` ولا يجوز أن يكون تاريخاً مستقبلياً. (إذا كان خارج فترة الوثيقة لا يمنع الحفظ، بل يتم تسجيله مع توليد `eligibilityHint` الاستشاري).
  3. **وصف الحادث:** حقل `description` اختياري (نص حتى 1000 حرف)، ويتم حفظه داخلياً كـ `incidentDescription`.
  4. **حظر تلميح الأهلية:** لا ترسلوا حقل `eligibilityHint` في الطلب؛ الخادم يقوم بحسابه وتوليده ذاتياً، وإرساله من العميل يسبب خطأ `400 VALIDATION_ERROR`.
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Claim created successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "NEW",
      "trackingToken": "d4e2a6b8c0f1e3d5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3",
      "trackingUrl": "http://localhost:3000/track/d4e2a6b8c0f1e3d5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3",
      "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
      "coverageSnapshot": {
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT", "FIRE", "NATURAL_DISASTER"],
        "deductibleAmount": 500,
        "capturedAt": "2026-08-26T15:00:00.000Z"
      },
      "createdAt": "2026-08-26T15:00:00.000Z"
    }
  }
  ```

---

### 3.1 إحصائيات ومؤشرات لوحة التحكم الرئيسية (Dashboard KPIs & Analytics)
* **المسار (Endpoint):** `GET /api/v1/claims/stats`
* **Headers:** `Authorization: Bearer <TOKEN>`
* **الأدوار المصرح لها:** `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`.
* **المكان في الواجهة الأمامية (Where this lives in UI):**
  1. **لوحة تحكم الويب للمدير وموظف المطالبات (Web Dashboard Overview):**
     - بطاقات مؤشرات الأداء العلوية (KPI Cards): إجمالي المطالبات (`totalClaims`)، المطالبات المعلقة التي تتطلب إجراءً إداريًا (`pendingActionCount`)، المطالبات غير المعينة (`unassigned`)، المطالبات بانتظار قبول المعاين (`pendingAcceptance`)، والمطالبات الجاهزة للمراجعة والتدقيق (`readyForReview`).
     - قسم أعباء عمل المعاينين (Adjusters Workload Cards): إجمالي المعاينين النشطين، المعاينين المتاحين، المعاينين القريبين من السعة القصوى، والمعاينين الذين بلغوا الحد الأقصى.
     - رسم بياني لحالات المطالبات التسع (`byStatus`).
     - فلتر التاريخ بالأعلى (`from` و `to`) لتحديد الفترة الزمنية للتقرير (أسبوع، شهر، سنة، أو مخصص).
  2. **تطبيق الجوال للمفتش الميداني (Mobile App Home Screen):**
     - يعرض إحصائيات المعاين الشخصية (`scope: ASSIGNED`): عدد المهام بانتظار البدء (`toStart`)، قيد المعاينة (`inProgress`)، بانتظار التصحيح (`needsCorrection`).
     - شريط السعة والعبء التشغيلي (`capacity: { active, max: 3 }`) لتنبيه المعاين عند امتلاء طاقته الاستيعابية.

* **Query Parameters (اختيارية):**
  * `from`: تاريخ البداية بتنسيق ISO أو `YYYY-MM-DD` (يتم تمديده تلقائيًا إلى بداية اليوم `00:00:00.000Z`). يمنع إدخال تاريخ في المستقبل.
  * `to`: تاريخ النهاية بتنسيق ISO أو `YYYY-MM-DD` (يتم تمديده تلقائيًا إلى نهاية اليوم `23:59:59.999Z`). إذا كان في المستقبل يتم تقييده تلقائيًا إلى التوقيت الحالي لسيرفر.
  * **شروط التحقق:** يرجع خطأ `400 Bad Request` برمز `VALIDATION_ERROR` إذا كان `from > to` أو كان التاريخ المستقبلي في `from` أو تجاوزت الفترة 5 سنوات.

---

#### أشكال الاستجابة (Both Response Shapes):

##### الشكل 1: نطاق المؤسسة بالكامل — `ORGANIZATION` Scope (خاص بالمدير وموظف المطالبات)
```json
{
  "success": true,
  "message": "Claim statistics retrieved successfully",
  "data": {
    "scope": "ORGANIZATION",
    "totalClaims": 14,
    "byStatus": {
      "NEW": 2,
      "PENDING_ACCEPTANCE": 1,
      "ASSIGNED": 3,
      "IN_PROGRESS": 2,
      "SUBMITTED": 1,
      "UNDER_REVIEW": 1,
      "CORRECTION_REQUIRED": 1,
      "APPROVED": 1,
      "REJECTED": 1,
      "CLOSED": 1
    },
    "pendingActionCount": 5,
    "actionableBreakdown": {
      "unassigned": 2,
      "pendingAcceptance": 1,
      "readyForReview": 2
    },
    "adjustersWorkload": {
      "totalActive": 3,
      "available": 3,
      "nearCapacity": 1,
      "atCapacity": 1
    }
  }
}
```

##### الشكل 2: نطاق المعاين الشخصي — `ASSIGNED` Scope (خاص بالمعاين الميداني)
```json
{
  "success": true,
  "message": "Claim statistics retrieved successfully",
  "data": {
    "scope": "ASSIGNED",
    "totalClaims": 6,
    "byStatus": {
      "NEW": 0,
      "ASSIGNED": 2,
      "IN_PROGRESS": 1,
      "SUBMITTED": 1,
      "UNDER_REVIEW": 0,
      "CORRECTION_REQUIRED": 1,
      "APPROVED": 1,
      "REJECTED": 0,
      "CLOSED": 0
    },
    "pendingActionCount": 4,
    "actionableBreakdown": {
      "toStart": 2,
      "inProgress": 1,
      "needsCorrection": 1
    },
    "capacity": {
      "active": 4,
      "max": 3
    }
  }
}
```

---

> [!WARNING]
> **ملاحظة معمارية وحسابية حاسمة لمن يبني بطاقات ورسوم الواجهة (KPI Cards Note):**
> في كائن أعباء عمل المعاينين `adjustersWorkload`، المقياسان **`available`** و **`atCapacity`** **ليسا مانعين لبعضهما (Non-mutually exclusive)**.
> - **سبب القاعدة في الباك إند:** وفقاً لقواعد عمل النظام ([BUSINESS_RULES.md](../project/BUSINESS_RULES.md) القاعدة Rule BR-ASSIGN-4)، يعتبر المعاين متاحاً (`AVAILABLE`) طالما أن مهامه النشطة $\le 3$. وفي الوقت ذاته، يعتبر المعاين قد وصل كامل سعته (`atCapacity`) إذا كانت مهامه النشطة $\ge 3$.
> - **النتيجة الحسابية:** المعاين الذي لديه **3 مهام نشطة بالضبط** يُحتسب ضمن المعاينين المتاحين `available` ($3 \le 3$) وأيضاً ضمن من بلغوا السعة القصوى `atCapacity` ($3 \ge 3$).
> - **إرشادات تصميم الواجهة (UI Directive):** **لا** تعرض هذه الأرقام كأجزاء من مخطط دائري (Pie Chart) نسبته 100%، لأن مجموعها قد يتجاوز `totalActive`. بدلاً من ذلك، اعرضها كـ **بطاقات إحصائية منفصلة ومستقلة (KPI Metric Cards)**.

---

### 3.2 استعراض ومراقبة جميع المطالبات (All Claims Oversight & Filtering)
* **المسار (Endpoint):** `GET /api/v1/claims`
* **Query Parameters (اختيارية):**
  * `status`: تصفية حسب حالة المطالبة (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`, `CLOSED`).
  * `adjusterId` (أو `assignedTo`): تصفية المطالبات المعينة لخبير معاينة محدد (`Field Adjuster ObjectId`).
  * `page`: رقم الصفحة (الافتراضي: 1).
  * `limit`: عدد العناصر في الصفحة (الافتراضي: 50، الأقصى: 100).
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>` أو `<CLAIMS_OFFICER_TOKEN>`
* **ملاحظة:** الأدمن وموظف المطالبات يستطيعان رؤية **جميع** مطالبات المؤسسة وتصفيتها حسب الحالة أو حسب خبير المعاينة (`adjusterId`). المطالبة غير المعينة ترجع `assignedTo: null`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claims retrieved successfully",
    "data": [
      {
        "id": "6a91ab09c9ff1dc54fabf15b",
        "claimNumber": "CLM-2026-0001",
        "status": "ASSIGNED",
        "customerName": "John Doe",
        "initialPlateNumber": "ABC-1234",
        "createdAt": "2026-09-08T10:00:00.000Z",
        "assignedTo": {
          "id": "6a91ab09c9ff1dc54fabf15c",
          "name": "Ahmed Ali"
        },
        "fieldAdjuster": {
          "id": "6a91ab09c9ff1dc54fabf15c",
          "name": "Ahmed Ali"
        }
      }
    ]
  }
  ```
  *(يتم إرجاع بيانات التصفح عبر Response Headers القياسية: `X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`).*

---

### 3.3 تفاصيل المطالبة بالكامل (Claim Details — Single Source of Truth)
* **المسار (Endpoint):** `GET /api/v1/claims/:claimId`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **الوظيفة:** يعرض جميع البيانات المطلوبة لصفحة تفاصيل المطالبة في طلب واحد — لا حاجة لطلبات إضافية.
* **البيانات المتوفرة:**
  1. **معلومات المطالبة:** `id`, `claimNumber`, `status`, `incidentType`, `incidentLocation`, `incidentCoordinates`, `createdAt`, `updatedAt`
  2. **بيانات العميل:** `customer.name`, `customer.phone`
  3. **بيانات المركبة:** `vehicle.plateNumber`, `vehicle.make`, `vehicle.model`, `vehicle.year`, `vehicle.color` — *(make/model/year/color تكون `null` حتى يؤكد المعاين المركبة أثناء المعاينة)*
  4. **بيانات البوليصة:** `policy.id`, `policy.policyNumber`, `policy.status`, `policy.startDate`, `policy.expiryDate`
  5. **بيانات التعيين:** `assignment.assignedTo` (كائن `{ id, name, employeeCode }`), `assignment.assignedBy`, `assignment.assignedAt`, `assignment.priority`, `assignment.assignmentNotes` — *تكون `null` للمطالبات الجديدة غير المعينة*
  6. **تفاصيل الحادث:** `accident` — *تكون `null` حتى يدخلها المعاين عبر الموبايل*
  7. **الموقع الجغرافي:** `location` — *تكون `null` حتى يلتقطها المعاين GPS*
  8. **الصور والأدلة:** `evidence[]` مصفوفة مع `imageType`, `url`, `uploadedBy: { id, name, employeeCode }`, `uploadedAt`
  9. **التوقيع:** `signature` — *تكون `null` حتى يلتقط التوقيع*
  10. **القرار والإغلاق:** `decisionNotes`, `closedBy`, `closedAt`, `closingNotes`
  11. **سجل الأحداث:** `timeline[]` — كل حدث يحتوي `performedBy: { id, name, employeeCode, role }`
  12. **منشئ المطالبة:** `createdBy: { id, name, employeeCode }`
  13. **لقطة التغطية التأمينية:** `coverageSnapshot: { policyType, coveredPerils[], deductibleAmount, capturedAt }` (أو `null`)
  14. **التقييم المالي والتعويض:** `lossAssessment: { estimatedPartsCost, laborCost, totalDamage, policyDeductible, deductibleApplied, deductibleOverrideReason, netApprovedPayout, currency, assessedAt, assessedBy }` (أو `null`)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim retrieved successfully",
    "data": {
      "id": "6a91ab09c9ff1dc54fabf15b",
      "claimNumber": "CLM-DEMO-0001",
      "status": "ASSIGNED",
      "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
      "incidentType": "COLLISION",
      "incidentLocation": "Al-Irsal St, Ramallah",
      "incidentDescription": "Front collision with another vehicle",
      "incidentCoordinates": {
        "latitude": 31.905,
        "longitude": 35.204,
        "capturedAt": "2026-08-26T15:00:00.000Z"
      },
      "createdAt": "2026-08-26T15:00:00.000Z",
      "updatedAt": "2026-08-26T15:10:00.000Z",
      "customer": {
        "name": "John Doe",
        "phone": "0591234567"
      },
      "vehicle": {
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2024,
        "color": "White"
      },
      "policy": {
        "id": "6a91ab09c9ff1dc54fabf160",
        "policyNumber": "POL-INS-001",
        "status": "ACTIVE",
        "startDate": "2026-01-01T00:00:00.000Z",
        "expiryDate": "2027-12-31T00:00:00.000Z"
      },
      "assignment": {
        "assignedTo": {
          "id": "6a91ab09c9ff1dc54fabf15c",
          "name": "Ahmed Ali",
          "employeeCode": "FA-001"
        },
        "assignedBy": {
          "id": "6a91ab09c9ff1dc54fabf15d",
          "name": "Sara Khan",
          "employeeCode": "CO-001"
        },
        "assignedAt": "2026-08-26T15:10:00.000Z",
        "priority": "HIGH",
        "assignmentNotes": "Urgent case"
      },
      "accident": {
        "accidentType": "COLLISION",
        "accidentDate": "2026-08-25",
        "accidentTime": "14:30",
        "description": "Front collision at intersection",
        "damageDescription": "Front bumper and hood damage"
      },
      "location": {
        "latitude": 31.905,
        "longitude": 35.204,
        "address": "Main St, Ramallah",
        "capturedAt": "2026-08-26T16:00:00.000Z"
      },
      "evidence": [
        {
          "imageType": "VEHICLE_FRONT",
          "url": "https://res.cloudinary.com/...",
          "uploadedBy": {
            "id": "6a91ab09c9ff1dc54fabf15c",
            "name": "Ahmed Ali",
            "employeeCode": "FA-001"
          },
          "uploadedAt": "2026-08-26T16:05:00.000Z"
        }
      ],
      "signature": {
        "url": "https://res.cloudinary.com/...",
        "capturedBy": "6a91ab09c9ff1dc54fabf15c",
        "capturedAt": "2026-08-26T16:30:00.000Z"
      },
      "decisionNotes": null,
      "closedBy": null,
      "closedAt": null,
      "closingNotes": null,
      "timeline": [
        {
          "action": "Claim Created",
          "previousStatus": null,
          "newStatus": null,
          "notes": null,
          "performedBy": {
            "id": "6a91ab09c9ff1dc54fabf15d",
            "name": "Sara Khan",
            "employeeCode": "CO-001",
            "role": "CLAIMS_OFFICER"
          },
          "role": "CLAIMS_OFFICER",
          "timestamp": "2026-08-26T15:00:00.000Z"
        }
      ],
      "createdBy": {
        "id": "6a91ab09c9ff1dc54fabf15d",
        "name": "Sara Khan",
        "employeeCode": "CO-001"
      },
      "coverageSnapshot": {
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT"],
        "deductibleAmount": 500,
        "capturedAt": "2026-08-26T15:00:00.000Z"
      },
      "lossAssessment": null
    }
  }
  ```
* **ملاحظة مهمة:** جميع مراجع المستخدمين (المعاين، الموظف، المنشئ) يتم إرجاعها ككائنات `{ id, name, employeeCode }` — لا حاجة لطلبات بحث إضافية.


### 3.4 اعتماد أو رفض المطالبة (Approve / Reject Claim Decision with Loss Assessment)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decision`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>` أو `<CLAIMS_OFFICER_TOKEN>`
* **الشرط البرمجي:** تظهر واجهة القرار والتقييم المالي **فقط عندما تكون حالة المطالبة `UNDER_REVIEW`**.
* **تعليمات صارمة للفرونت إند (Frontend Rules):**
  1. **الأرقام المالية JSON Numbers فقط:** يجب إرسال القيم المالية (`estimatedPartsCost`, `laborCost`, `deductibleApplied`) كأرقام رقمية بحتة (مثل `12.5` أو `800`) وليس كنصوص أبداً مثل `"12.50"` أو `"800"`. الخادم يطبق فحصاً صارماً (`.strict()`) ويرفض النصوص بـ `400 Bad Request`. احرصوا على تحويل مخرجات عناصر الإدخال عبر `parseFloat` أو `Number` قبل إرسال كائن الـ JSON.
  2. **الحد الأقصى للمنازل العشرية:** خانتان عشريتان كحد أقصى (مثلاً `12.50` مقبول كـ `12.5`، بينما `12.345` يُرفض بـ `400`).
  3. **عدم إرسال الحقول المحسوبة:** لا ترسلوا أي حقل يتم حسابه تلقائياً في السيرفر مثل `totalDamage` أو `netApprovedPayout` أو `policyDeductible` أو `assessedBy`. الخادم يرفض أي مفتاح غير معروف داخل `lossAssessment` بـ `400 VALIDATION_ERROR`.
  4. **المفاتيح الأربعة المسموحة فقط داخل `lossAssessment`:**
     - `estimatedPartsCost` (إلزامي، رقم $\ge 0$)
     - `laborCost` (إلزامي، رقم $\ge 0$)
     - `deductibleApplied` (اختياري، رقم $\ge 0$ — إن لم يُرسل يُعتمد تحمل الوثيقة تلقائياً)
     - `deductibleOverrideReason` (إلزامي إذا وفقط إذا اختلف `deductibleApplied` عن تحمل الوثيقة، نص بين 10 و 300 حرف)
  5. **التقييم المالي إلزامي للاعتماد ومحظور للرفض:** في حال كان القرار `APPROVED`، فإن كائن `lossAssessment` إلزامي تماماً وغيابه يرجع `400 VALIDATION_ERROR`. وفي حال كان القرار `REJECTED` يُمنع منعاً باتاً إرسال كائن `lossAssessment` (إرساله يسبب رفض الطلب بـ `400 VALIDATION_ERROR`).
   6. **تحديث العرض في الواجهة بعد نجاح الاعتماد:** ترجع استجابة القرار `POST /claims/:claimId/decision` حقل `assessedBy` كمعرّف نصي فقط (`ID string`)، في حين أن مسار جلب تفاصيل المطالبة `GET /claims/:claimId` يُرجعه كائناً مفصلاً بالاسم والرقم الوظيفي (`{ id, name, employeeCode }`). لذلك، احرصوا بعد نجاح الاعتماد على إعادة جلب المطالبة (`GET /claims/:claimId`) واستخدامها لتحديث حالة الواجهة وعرض بيانات المقيّم المالي، ولا تعتمدوا على كائن استجابة القرار وحده للعرض.
* **Request Body (حالة الاعتماد مع التقييم المالي):**
  ```json
  {
    "decision": "APPROVED",
    "notes": "تمت مراجعة تقدير الأضرار والموافقة على التعويض.",
    "lossAssessment": {
      "estimatedPartsCost": 1200.0,
      "laborCost": 800.0,
      "deductibleApplied": 500.0,
      "deductibleOverrideReason": null
    }
  }
  ```
* **Request Body (حالة الرفض):**
  ```json
  {
    "decision": "REJECTED",
    "notes": "الأضرار لا تتطابق مع تفاصيل الحادث المصرح بها."
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Decision recorded successfully",
    "data": {
      "id": "6a91ab09c9ff1dc54fabf15b",
      "claimNumber": "CLM-2026-0001",
      "status": "APPROVED",
      "decisionNotes": "تمت مراجعة تقدير الأضرار والموافقة على التعويض.",
      "lossAssessment": {
        "estimatedPartsCost": 1200.0,
        "laborCost": 800.0,
        "totalDamage": 2000.0,
        "policyDeductible": 500.0,
        "deductibleApplied": 500.0,
        "deductibleOverridden": false,
        "deductibleOverrideReason": null,
        "netApprovedPayout": 1500.0,
        "currency": "ILS",
        "assessedAt": "2026-09-28T13:27:13.000Z",
        "assessedBy": "6a91ab09c9ff1dc54fabf15d"
      }
    }
  }
  ```
* **أكواد الأخطاء الخاصة بالواجهة:**
  * `422 Unprocessable Entity`:
    - كود `DAMAGE_BELOW_DEDUCTIBLE`: عندما يكون مجموع الأضرار (`totalDamage`) أقل من أو يساوي مبلغ التحمل المطبق (`deductibleApplied`). في هذه الحالة **لا يتم تعديل حالة المطالبة وتبقى `UNDER_REVIEW`** ودون حفظ أي بيانات مالية.
    - كود `OVERRIDE_REASON_REQUIRED`: عندما يختلف مبلغ التحمل المطبق (`deductibleApplied`) عن تحمل الوثيقة (`policyDeductible`) دون تقديم سبب تعديل مبرر (`deductibleOverrideReason` بين 10 و 300 حرف).
    - كود `OVERRIDE_REASON_NOT_ALLOWED`: عند إرسال سبب تعديل مبرر (`deductibleOverrideReason`) رغم تطابق مبلغ التحمل المطبق مع تحمل الوثيقة.
  * `400 Bad Request`: كود `VALIDATION_ERROR` عند إرسال نصوص في الحقول المالية بدلاً من أرقام، أو منازل عشرية تزيد عن 2، أو حقول مجهولة (مثل `totalDamage` أو `netApprovedPayout`)، أو إرسال تقييم مالي مع قرار الرفض `REJECTED`، أو أن يكون إجمالي الضرر صفر أو سالب (`totalDamage <= 0`)، أو عند غياب `lossAssessment` في قرار الاعتماد `APPROVED`.
  * `404 Not Found`: كود `CLAIM_NOT_FOUND` إذا كانت المطالبة غير موجودة أو تابعة لمنظمة أخرى (تأمين متعدد المستأجرين).
  * `409 Conflict`: كود `INVALID_STATUS_TRANSITION` إذا لم تكن المطالبة في حالة `UNDER_REVIEW` (أو عند حدوث تضارب تزامن بالاعتماد المتزامن).

---

### 3.5 إغلاق المطالبة نهائياً (Close Claim) — *صلاحية حصرية للمدير فقط*
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/close`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **الشرط البرمجي:** يظهر زر "إغلاق المطالبة" **فقط عندما تكون حالة المطالبة `APPROVED`**.
* **Request Body:**
  ```json
  {
    "closingNotes": "تم تحويل مبلغ التعويض للحساب البنكي وإغلاق الملف بالكامل."
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim closed successfully",
    "data": {
      "id": "6a91ab09c9ff1dc54fabf15b",
      "claimNumber": "CLM-2026-0001",
      "status": "CLOSED",
      "closedBy": "6aa27838cda4d3dca00b83ab",
      "closedAt": "2026-09-10T10:20:00.000Z",
      "closingNotes": "تم تحويل مبلغ التعويض للحساب البنكي وإغلاق الملف بالكامل."
    }
  }
  ```
* **أخطاء محتملة:**
  * إذا لم تكن المطالبة في حالة `APPROVED`: يرجع خطأ `409 Conflict` برمز `INVALID_STATUS_TRANSITION`.

---

### 3.6 تحميل التقرير النهائي للمطالبة بصيغة PDF (Download Final Claim Report)
* **المسار (Endpoint):** `GET /api/v1/claims/:claimId/report`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **الأدوار المصرح لها:** `ADMIN`, `CLAIMS_OFFICER`.
* **المكان في الواجهة وتجربة المستخدم (UI Placement & State Rules):**
  * في صفحة تفاصيل المطالبة (Claim Details Screen) أو قائمة الإجراءات السريعة (Action Menu).
  * **شرط الظهور في الواجهة:** يظهر زر **"تحميل التقرير النهائي (PDF)"** أو **"Download Report"** **فقط وحصرياً** عندما تكون المطالبة قد وصلت إلى قرار نهائي:
    * `APPROVED` (معتمدة)
    * `REJECTED` (مرفوضة)
    * `CLOSED` (مغلقة)
  * **في الحالات غير النهائية** (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`): يجب إخفاء الزر تماماً أو تعطيله (Disabled) لمنع طلب تقارير غير مكتملة.

> [!CAUTION]
> **تنبيه تقني حاسم لمطور الفرونت إند (Authentication & Blob Download Requirement):**
> - **لا يمكن** استخدام رابط مباشر أو وسم HTML عادي مثل `<a href="/api/v1/claims/:claimId/report">`، لأن المتصفح لن يُرفق هيدر المصادقة الإجباري `Authorization: Bearer <TOKEN>`، مما يتسبب في رفض الطلب بـ `401 Unauthorized`.
> - **طريقة التنفيذ الصحيحة:** يجب طلب الـ Endpoint عبر `fetch` أو `axios` مع إرسال الـ Authorization Header، واستلام الاستجابة كـ **`Blob`**، ثم توليد رابط تنزيل محلي عبر `window.URL.createObjectURL(blob)`.

#### كود جاهز للاستخدام في الواجهة الأمامية (React / Vue / Vanilla JS):
```javascript
async function downloadClaimReport(claimId, claimNumber, token) {
  try {
    const response = await fetch(`/api/v1/claims/${claimId}/report`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // في حالة الخطأ يرجع الباك إند كائن JSON عادي بالخطأ
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to download report');
    }

    // استلام الرد كـ Blob ثنائي (Binary PDF)
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${claimNumber || 'claim'}-report.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Error downloading claim report:', error);
    // إظهار تنبيه أو Toast للمستخدم بالخطأ
  }
}
```

* **الاستجابة الناجحة (200 OK):**
  * نوع المحتوى: `Content-Type: application/pdf`
  * الهيدر: `Content-Disposition: attachment; filename="<claimNumber>-report.pdf"`
  * محتوى الرد: مصفوفة بايتات ثنائية للـ PDF تبدأ بتوقيع `%PDF`.
* **أخطاء محتملة (ترجع في مغلف JSON القياسي):**
  * `403 Forbidden`: إذا حاول دور غير مصرح له (مثل `FIELD_ADJUSTER`) تحميل التقرير.
  * `404 Not Found`: المطالبة غير موجودة أو تابعة لمؤسسة أخرى.
  * `409 Conflict`: محاولة تحميل التقرير لمطالبة لم يصدر فيها قرار نهائي بعد (الرسالة: `"Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED)."`).

---

## 4. جدول أكواد الاستجابة السريعة (HTTP Status Codes Guide)

| الكود | المعنى | طريقة التعامل في الواجهة الأمامية |
| :---: | :--- | :--- |
| `200` | عملية ناجحة (OK) | تحديث البيانات في الجدول / إظهار إشعار نجاح (Toast) |
| `201` | تم الإنشاء بنجاح (Created) | إغلاق الـ Modal وإعادة جلب قائمة الموظفين |
| `400` | خطأ في المدخلات (Bad Request) | إظهار رسائل الخطأ تحت الحقول المدخلة (Validation Error) |
| `401` | غير مصرح (Unauthorized) | التوكن غير صالح أو منتهي -> توجيه المستخدم لصفحة تسجيل الدخول |
| `403` | صلاحيات غير كافية (Forbidden) | المستخدم لا يملك الصلاحية (مثلاً غير الأدمن يحاول الدخول للوحة) |
| `404` | غير موجود (Not Found) | إظهار صفحة أو رسالة "المستخدم أو المطالبة غير موجودة" |
| `409` | تعارض (Conflict) | إظهار رسالة واضحة للمستخدم (مثل: كود الموظف مكرر، أو حالة المطالبة لا تسمح) |

---

## 5. واجهات توزيع المعاينين والخريطة (Map-Based Adjuster Dispatch — Feature 18)

### 5.1 جلب قائمة المعاينين مع المسافات الأقرب لمكان الحادث (List Adjusters with Proximity)
* **المسار (Endpoint):** `GET /api/v1/users/adjusters`
* **Headers:** `Authorization: Bearer <OFFICER_OR_ADMIN_TOKEN>`
* **Query Parameters (اختيارية للفرونت إند والخريطة):**
  * `claimId`: معرف المطالبة المراد تعيينها. يقوم الباك إند تلقائياً باستخراج إحداثيات الحادث (`claim.incidentCoordinates`) وحساب مسافة كل معاين عنها بالكيلومتر عبر معادلة Haversine.
  * `latitude` & `longitude`: تمرير إحداثيات مرجعية مباشرة لحساب المسافة بدلاً من معرف المطالبة.
  * `status`: `available` لجلب المتاحين فقط، أو `all` (الافتراضي) لجلب جميع المعاينين النشطين.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "6aa27838cda4d3dca00b83ab",
        "name": "Ahmad Adjuster",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "AVAILABLE",
        "activeTasksCount": 1,
        "capacityLimit": 3,
        "location": {
          "latitude": 31.9038,
          "longitude": 35.2034,
          "updatedAt": "2026-09-14T07:25:00.000Z"
        },
        "distanceKm": 0.15
      },
      {
        "id": "6aa27838cda4d3dca00b83ac",
        "name": "Khaled Adjuster",
        "employeeCode": "FA-002",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "UNAVAILABLE",
        "activeTasksCount": 4,
        "capacityLimit": 3,
        "location": {
          "latitude": 31.9200,
          "longitude": 35.2200,
          "updatedAt": "2026-09-14T07:15:00.000Z"
        },
        "distanceKm": 2.34
      },
      {
        "id": "6aa27838cda4d3dca00b83ad",
        "name": "Omar Adjuster",
        "employeeCode": "FA-003",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "AVAILABLE",
        "activeTasksCount": 0,
        "capacityLimit": 3,
        "location": {
          "latitude": null,
          "longitude": null,
          "updatedAt": null
        },
        "distanceKm": null
      }
    ]
  }
  ```
* **ملاحظات للفرونت والخريطة:**
  * الترتيب يرجع تصاعدياً حسب `distanceKm` (الأقرب للحادث أولاً).
  * المعاين الذي لم يرسل موقعه بعد يظهر في نهاية القائمة وتكون قيمة `distanceKm: null`.

### 5.2 تعيين المعاين بنظام الخطوتين وتجاوز السعة (Two-Step Assign & Capacity Override)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/assign`
* **المستخدم المصرح له:** موظف المطالبات والمسؤول (`CLAIMS_OFFICER`, `ADMIN`).
* **Headers:** `Authorization: Bearer <OFFICER_TOKEN or ADMIN_TOKEN>`
* **Request Body:**
  ```json
  {
    "adjusterId": "6aa27838cda4d3dca00b83ac",
    "priority": "HIGH",
    "notes": "Urgent VIP inspection",
    "overrideCapacity": true
  }
  ```
* **سلوك الواجهة (UI Flow):**
  1. إذا أرسل الفرونت الطلب بدون `overrideCapacity: true` وكان لدى المعاين أكثر من 3 مهام نشطة (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`)، يرجع الباك إند خطأ `409 Conflict` بكود `ADJUSTER_UNAVAILABLE`.
  2. يقوم الفرونت بإظهار مربع حوار تأكيدي للمسؤول (Modal): *"المعاين لديه أكثر من 3 مهام حالياً، هل تود تأكيد التعيين وتجاوز السعة؟"*.
  3. عند ضغط المستخدم "نعم / تأكيد التجاوز"، يعيد الفرونت إرسال نفس الطلب مع إضافة `"overrideCapacity": true`.
  4. عند نجاح التعيين، تتحول حالة المطالبة إلى **`PENDING_ACCEPTANCE`** (بانتظار قبول المعاين من تطبيقه) وليس `ASSIGNED` مباشرة، ولا تُحتسب المطالبة ضمن سعة المعاين في هذه المرحلة حتى يقبلها.
  5. عند تجاوز السعة، يُسجل الباك إند تلقائياً في الخط الزمني:
     `"[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)"`.

### 5.3 قبول التكليف من تطبيق المعاين (Adjuster Accept Assignment)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/accept-assignment`
* **المستخدم المصرح له:** حصرياً المعاين الميداني المكلّف بهذه المطالبة (`FIELD_ADJUSTER`).
* **Headers:** `Authorization: Bearer <ADJUSTER_TOKEN>`
* **Request Body:** `{}` (جسم فارغ)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment accepted",
    "data": {
      "id": "6aa27838cda4d3dca00b83ac",
      "claimNumber": "CLM-INS-0001",
      "status": "ASSIGNED",
      "assignedTo": "6aa27838cda4d3dca00b83ac"
    }
  }
  ```
* **سلوك الواجهة:**
  - تتحول حالة المطالبة من `PENDING_ACCEPTANCE` إلى `ASSIGNED`.
  - يُفعل زر "بدء المعاينة" (`POST /inspection/start`) في شاشة المعاين.
  - يُسجل في الخط الزمني: `[ASSIGNMENT ACCEPTED] by <employeeCode>`.

### 5.4 رفض التكليف وإعادة التوزيع (Adjuster Decline Assignment Workflow)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decline-assignment`
* **المستخدم المصرح له:** حصرياً المعاين الميداني المكلّف بهذه المطالبة (`FIELD_ADJUSTER`).
* **Headers:** `Authorization: Bearer <ADJUSTER_TOKEN>`
* **Request Body:**
  ```json
  {
    "reason": "تعطل في المركبة ولا يمكن الوصول في الوقت المحدد"
  }
  ```
* **سلوك النظام والواجهة:**
  1. حقل `reason` إلزامي (نص من 1 إلى 300 حرف كحد أقصى).
  2. يتم تحويل حالة المطالبة ذرياً من `PENDING_ACCEPTANCE` إلى `NEW` وتصفير حقول التكليف (`assignedTo: null`).
  3. تظهر المطالبة فوراً من جديد على خريطة وقائمة موظف المطالبات في حالة `NEW` ليعيد توزيعها لمعاين آخر.
  4. يُسجل في الخط الزمني: `[ASSIGNMENT DECLINED] by <employeeCode> — <reason>`.
  5. إذا حاول موظف مطالبات أو أدمن استدعاء المسار يُرجع `403 Forbidden`.
  6. إذا حاول معاين آخر غير المكلف استدعاء المسار يُرجع `404 Not Found` (Stealth Tenancy).

### 5.5 إحداثيات الحادث في تفاصيل وقائمة المطالبات (Incident Coordinates for Maps)
* **المسارات:** `GET /api/v1/claims/:claimId` وأيضاً قائمة المطالبات `GET /api/v1/claims`.
* يرجع الباك إند كائن إحداثيات الحادث لرسم نقاط وماركرز الحوادث على الخريطة مباشرة:
  ```json
  "incidentCoordinates": {
    "latitude": 31.9050,
    "longitude": 35.2040,
    "capturedAt": "2026-09-14T07:27:55.000Z"
  }
  ```
  *(إذا لم تُسجل إحداثيات عند إنشاء المطالبة، يرجع الحقل بقيمة `null`)*.

---

## 6. مركز الإشعارات (Dashboard Notification Center)

يوفر مركز الإشعارات للمستخدمين (`ADMIN` و `CLAIMS_OFFICER` و `FIELD_ADJUSTER`) إمكانية استعراض الإشعارات الخاصة بهم، متابعة العداد غير المقروء كبادج (Badge) في شريط التنقل العلوي، وتحديث حالة قراءة الإشعار (`readAt`) بشكل متزامن.

### 6.1 قائمة الإشعارات (List Notifications)
* **المسار (Endpoint):** `GET /api/v1/notifications`
* **المستخدمون المصرح لهم:** كافة المستخدمين المسجلين (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
* **Headers:** `Authorization: Bearer <TOKEN>`
* **Query Parameters (اختيارية):**
  * `page`: رقم الصفحة (افتراضي `1`).
  * `limit`: عدد العناصر في الصفحة (افتراضي `50`، الحد الأقصى `100`).
  * `unreadOnly`: قيمة منطقية (`true` أو `false`، افتراضي `false`). عند إرسال `true` يتم تصفية وعرض الإشعارات غير المقروءة فقط (`readAt == null`).
* **Response Headers (Pagination Headers):**
  * `X-Total-Count`: إجمالي عدد الإشعارات المطابقة للفلتر.
  * `X-Page`: رقم الصفحة الحالي.
  * `X-Limit`: حجم الصفحة الحالي.
  * `X-Total-Pages`: إجمالي عدد الصفحات المتاحة.
* **شكل الاستجابة الناجحة (HTTP 200):**
  ```json
  {
    "success": true,
    "message": "Notifications retrieved successfully",
    "data": [
      {
        "_id": "673f8a45b12c3d0012ef3456",
        "recipientId": "673f8a45b12c3d0012ef3401",
        "organizationId": "673f8a45b12c3d0012ef3400",
        "type": "NEW_CLAIM",
        "relatedClaimId": {
          "_id": "673f8a45b12c3d0012ef3410",
          "claimNumber": "CLM-ALPHA-0042"
        },
        "title": "New Claim Created",
        "body": "New claim CLM-ALPHA-0042 has been created.",
        "readAt": null,
        "createdAt": "2026-09-23T19:00:00.000Z"
      }
    ]
  }
  ```
* **ملاحظة معمارية هامة:** يتم حل `relatedClaimId` تلقائياً ليحتوي على `claimNumber` عند جلب البيانات دون تخزينه مكرراً في جدول الإشعارات.

### 6.2 عداد الإشعارات غير المقروءة (Unread Count Badge)
* **المسار (Endpoint):** `GET /api/v1/notifications/unread-count`
* **المستخدمون المصرح لهم:** كافة المستخدمين المسجلين (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
* **Headers:** `Authorization: Bearer <TOKEN>`
* **الاستخدام في الواجهة الأمامية:** استدعاء خفيف وسريع عند تحميل الصفحة أو عبر Polling دوري لتحديث رقم البادج الأحمر فوق أيقونة الجرس في شريط الهيدر.
* **شكل الاستجابة الناجحة (HTTP 200):**
  ```json
  {
    "success": true,
    "message": "Unread count retrieved successfully",
    "data": {
      "count": 4
    }
  }
  ```

### 6.3 تحديد الإشعار كمقروء (Mark Notification as Read)
* **المسار (Endpoint):** `PATCH /api/v1/notifications/:id/read`
* **المستخدمون المصرح لهم:** مستلم الإشعار حصرياً (`req.user.userId`).
* **Headers:** `Authorization: Bearer <TOKEN>`
* **Parameters:** `:id` — معرّف الإشعار (MongoDB ObjectId).
* **سلوك النظام والواجهة:**
  1. يسجل تاريخ ووقت القراءة في حقل `readAt`.
  2. العملية محايدة التكرار (Idempotent): تكرار النقر على الإشعار لا يغير تاريخ القراءة المسجل أول مرة.
  3. يطبق مبدأ عزل المستأجر الصارم (Stealth Tenancy): إذا كان الإشعار يخص مستخدماً آخر أو شركة أخرى يرجع فوراً `404 Not Found` برمز `NOTIFICATION_NOT_FOUND`.
* **شكل الاستجابة الناجحة (HTTP 200):**
  ```json
  {
    "success": true,
    "message": "Notification marked as read",
    "data": {
      "_id": "673f8a45b12c3d0012ef3456",
      "recipientId": "673f8a45b12c3d0012ef3401",
      "organizationId": "673f8a45b12c3d0012ef3400",
      "type": "NEW_CLAIM",
      "relatedClaimId": {
        "_id": "673f8a45b12c3d0012ef3410",
        "claimNumber": "CLM-ALPHA-0042"
      },
      "title": "New Claim Created",
      "body": "New claim CLM-ALPHA-0042 has been created.",
      "readAt": "2026-09-23T19:15:30.123Z",
      "createdAt": "2026-09-23T19:00:00.000Z"
    }
  }
  ```

---

## 7. تتبع المطالبة للجمهور والعميل (Public Customer Claim Tracking — Feature 23)

تتيح هذه الواجهة لعميل شركة التأمين (المستفيد / صاحب المركبة) متابعة حالة ومسار مطالبته بصورة عامة ومباشرة دون الحاجة لتسجيل الدخول أو امتلاك حساب على المنصة.

### 7.1 الاستعلام عن حالة المطالبة عبر رمز التتبع (Get Public Claim Status)
* **المسار (Endpoint):** `GET /api/v1/public/claims/track/:trackingToken`
* **المصادقة (Auth):** عامة بالكامل (Public) — لا تتطلب أي Header للمصادقة أو تسجيل دخول.
* **المعاملات (Path Parameters):**
  * `trackingToken` (إجباري): رمز التتبع الفريد الخاص بالمطالبة (64 حرفاً Hexadecimal بدقة 256-bit). يُنشأ تلقائياً عند فتح المطالبة ويُعاد في استجابة `POST /api/v1/claims`.
* **الحماية وسرية البيانات (Security & Privacy):**
  * يمنع حفظ الرد في الكاش عبر ترويسات: `Cache-Control: no-store` و `Pragma: no-cache`.
  * حماية ضد التخمين والتعداد (Anti-Enumeration): أي رمز غير صالح، بصيغة خاطئة، أو غير موجود يرجع دائماً رد الخطأ الموحد `404 Not Found` برسالة `"Claim not found"`.
  * عزل تام للبيانات الحساسة: لا يُرجع النظام أي معرّفات داخلية (`_id`, `organizationId`)، ولا أرقام هواتف، ولا صور الأدلة، ولا التواقيع، ولا تقييمات الخسائر المالية، ولا الملاحظات الإدارية.
* **شكل الاستجابة الناجحة (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim status retrieved successfully",
    "data": {
      "claimNumber": "CLM-DEMO-0001",
      "status": "IN_PROGRESS",
      "statusDescription": "Your claim is being inspected.",
      "customerName": "Ahmad Khalid",
      "incidentType": "COLLISION",
      "createdAt": "2026-09-20T10:30:00.000Z",
      "updatedAt": "2026-09-25T14:00:00.000Z",
      "timeline": [
        {
          "label": "Claim Received",
          "timestamp": "2026-09-20T10:30:00.000Z"
        },
        {
          "label": "Inspector Assigned",
          "timestamp": "2026-09-21T09:00:00.000Z"
        },
        {
          "label": "Inspection Started",
          "timestamp": "2026-09-21T11:00:00.000Z"
        }
      ]
    }
  }
  ```

### 7.2 جدول مطابقة الحالات الداخلية لحالات الجمهور (Status Mapping)

| الحالة الداخلية في النظام | الحالة المعروضة للعميل (`status`) | الوصف التوضيحي للعميل (`statusDescription`) |
|---|---|---|
| `NEW` | `RECEIVED` | Your claim has been received and is being processed. |
| `PENDING_ACCEPTANCE` | `RECEIVED` | Your claim has been received and is being processed. |
| `ASSIGNED` | `IN_PROGRESS` | An inspector has been assigned to your claim. |
| `IN_PROGRESS` | `IN_PROGRESS` | Your claim is being inspected. |
| `SUBMITTED` | `IN_REVIEW` | Your inspection is complete and under review. |
| `UNDER_REVIEW` | `IN_REVIEW` | Your inspection is complete and under review. |
| `CORRECTION_REQUIRED` | `IN_PROGRESS` | Additional information is being gathered. |
| `APPROVED` | `APPROVED` | Your claim has been approved. |
| `REJECTED` | `REJECTED` | Your claim has been declined. |
| `CLOSED` | `CLOSED` | Your claim has been finalized and closed. |

### 7.3 إرشادات لمطور الواجهة الأمامية (Frontend Implementation Notes)
1. **إنشاء رابط التتبع:** يمكن مشاركة رابط التتبع مع العميل عبر رسالة نصية أو بريد إلكتروني، على سبيل المثال:
   `https://app.insurflow.com/track/:trackingToken`
2. **صفحة التتبع للعميل:**
   * عند فتح الرابط، تقوم الصفحة بطلب `GET /api/v1/public/claims/track/:trackingToken`.
   * في حالة التحميل (Loading)، يُعرض مؤشر تحميل هادئ وبسيط.
   * في حالة `404 Not Found`، يُعرض تنبيه ودود للعميل: "رابط التتبع غير صالح أو المطالبة غير موجودة، يُرجى التأكد من الرابط أو التواصل مع خدمة العملاء".
   * في حالة النجاح، تُعرض بطاقة المطالبة مع شريط تقدم (Progress Bar) أو خط زمني (Timeline) يوضح المعالم المكتملة بناءً على قائمة `timeline` المرجعة.
3. **استرجاع رابط التتبع في أي وقت:** يتوفر حقل `trackingToken` أيضاً داخل استجابة تفاصيل المطالبة الفردية `GET /api/v1/claims/:claimId` للموظفين المصرح لهم، مما يسمح للموظف بنسخ رابط التتبع ومشاركته مع العميل في أي وقت خلال دورة حياة المطالبة، مع ضمان عدم تسريبه في قوائم المطالبات `GET /api/v1/claims`.
