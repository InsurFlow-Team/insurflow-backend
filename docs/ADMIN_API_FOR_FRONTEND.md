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

### 2.5 استعراض المعاينين الميدانيين وحمل العمل (Adjusters Workload)
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
        "activeTasksCount": 0
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
     - بطاقات مؤشرات الأداء العلوية (KPI Cards): إجمالي المطالبات (`totalClaims`)، المطالبات المعلقة التي تتطلب إجراءً إداريًا (`pendingActionCount`)، المطالبات غير المعينة (`unassigned`)، والمطالبات الجاهزة للمراجعة والتدقيق (`readyForReview`).
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
    "totalClaims": 13,
    "byStatus": {
      "NEW": 2,
      "ASSIGNED": 3,
      "IN_PROGRESS": 2,
      "SUBMITTED": 1,
      "UNDER_REVIEW": 1,
      "CORRECTION_REQUIRED": 1,
      "APPROVED": 1,
      "REJECTED": 1,
      "CLOSED": 1
    },
    "pendingActionCount": 4,
    "actionableBreakdown": {
      "unassigned": 2,
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

### 3.2 استعراض ومراقبة جميع المطالبات (All Claims Oversight)
* **المسار (Endpoint):** `GET /api/v1/claims?status=UNDER_REVIEW&page=1&limit=20`
* **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
* **ملاحظة:** الأدمن يستطيع رؤية **جميع** مطالبات المؤسسة بمختلف حالاتها.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Success",
    "data": {
      "claims": [
        {
          "id": "6a91ab09c9ff1dc54fabf15b",
          "claimNumber": "CLM-2026-0001",
          "status": "UNDER_REVIEW",
          "customerName": "John Doe",
          "initialPlateNumber": "ABC-1234",
          "createdAt": "2026-09-08T10:00:00.000Z"
        }
      ],
      "pagination": {
        "totalCount": 1,
        "page": 1,
        "limit": 20,
        "totalPages": 1
      }
    }
  }
  ```

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
