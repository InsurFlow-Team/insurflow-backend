# دليل واجهات وبرمجة دور المدير للفرونت إند (Admin API Documentation for Frontend)

يقدم هذا التوثيق مرجعاً كاملاً لمطور الواجهة الأمامية (**Frontend Developer**) لربط جميع واجهات ووظائف المدير (**ADMIN**) في منصة **InsurFlow**.

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

### 3.3 تفاصيل المطالبة بالكامل (Claim Details & Timeline)
* **المسار (Endpoint):** `GET /api/v1/claims/:claimId`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **الوظيفة:** يعرض بيانات العميل، المركبة، صور وأضرار الحادث، والموقع الجغرافي، وسجل التايم لاين (`timeline`) الكامل بالأحداث ومن قام بها.

---

### 3.4 اعتماد أو رفض المطالبة (Approve / Reject Claim Decision)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decision`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **الشرط البرمجي:** تظهر أزرار الاعتماد/الرفض في الواجهة **فقط عندما تكون حالة المطالبة `UNDER_REVIEW`**.
* **Request Body:**
  ```json
  {
    "decision": "APPROVED",
    "notes": "تمت مراجعة تقدير الأضرار والموافقة على التعويض."
  }
  ```
  *(أو `"decision": "REJECTED"` في حال الرفض)*
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim decision recorded successfully",
    "data": {
      "id": "6a91ab09c9ff1dc54fabf15b",
      "claimNumber": "CLM-2026-0001",
      "status": "APPROVED",
      "decisionNotes": "تمت مراجعة تقدير الأضرار والموافقة على التعويض."
    }
  }
  ```

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
