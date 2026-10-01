# وثيقة تسليم ومواءمة واجهات المستخدم الأمامية (Frontend Handoff & Contract Alignment)

هذه الوثيقة موجهة لفريق تطوير الواجهات الأمامية (Frontend Team) لتوضيح التغييرات والاتفاقيات البرمجية لنقاط النهاية، التحقق، شاشات فتح ومتابعة المطالبات، واتخاذ القرار في نظام **InsurFlow**.

---

## 1. التغييرات المؤثرة على العملاء والواجهات الحالية (Changes Affecting Existing Clients)

1. **`incidentDate` إجباري (Required):** أصبح حقل تاريخ وقوع الحادث إجبارياً في التحقق وإنشاء المطالبة بصيغة `YYYY-MM-DD`.
2. **`description` اختياري (Optional):** حقل وصف الحادث اختياري بحد أقصى 1000 حرف.
3. **إحداثيات مسطحة (Flat Latitude & Longitude):** يتم إرسال الإحداثيات مباشرة كحقول رقمية مسطحة `latitude` و `longitude` بدلاً من كائنات متداخلة.
4. **تحديث سلوك التحقق من الوثيقة (Policy Verification):** لم تعد نقطة النهاية تُرجع الأكواد الملغاة `POLICY_EXPIRED` أو `POLICY_NOT_ACTIVE_ON_DATE`. كل وثيقة غير ملغاة تُرجع حالة نجاح `200 OK` مع `isEligible: true`، وتظهر الفروقات الزمنية أو عدم تغطية الحادث عبر كود التوجيه `eligibilityHint`. فقط الوثيقة الملغاة تُرجع `422 POLICY_CANCELLED`.
5. **هيكل جديد لاستجابة التتبع العام (New Public Tracking Response Shape):** تم تبسيط الاستجابة العامة للعملاء لتشمل فقط: `claimNumber`، `status`، `statusDescription`، `vehicle` (مع قناع للوحة)، و `timeline` (خط زمني تصاعدي باتجاه واحد forward-only).
6. **إخفاء وتشفير أرقام اللوحات للجمهور (Plate Masking):** يُعرض رقم اللوحة في التتبع العام بصيغة محجوبة لحماية الخصوصية (مثال: `ABC-xxx4`).
7. **تقييد صلاحية الوصول إلى رمز التتبع (trackingToken Restricted by Role):** يظهر `trackingToken` و `trackingUrl` فقط للمسؤولين (`ADMIN`) وموظفي المطالبات (`CLAIMS_OFFICER`). يُحجب الحقلان تماماً عن المعاين الميداني (`FIELD_ADJUSTER`).
8. **تقييم الأضرار إلزامي للموافقة (lossAssessment Mandatory for Approvals):** أصبح حقل `lossAssessment` إلزامياً عند اتخاذ قرار الموافقة `APPROVED`، بينما يُحظر إرسال كائن فيه عند الرفض `REJECTED` (يُقبل غيابه أو القيمة `null` فقط).

---

## 2. تفاصيل الشاشات ونقاط النهاية (Screen-by-Screen Specifications)

### 2.1 شاشة التحقق من الوثيقة (Policy Verification Screen)

* **المسار (Endpoint):** `POST /api/v1/policies/verify`
* **المصادقة (Auth):** مطلوبة (Bearer Token — للموظف أو المسؤول).
* **حقول الطلب (Request Fields):**
  * `policyNumber` (String, اختياري إذا أُرسل plateNumber): رقم الوثيقة.
  * `plateNumber` (String, اختياري إذا أُرسل policyNumber): رقم لوحة المركبة للمطابقة.
  * `incidentDate` (String, إجباري, صيغة `YYYY-MM-DD`): تاريخ وقوع الحادث (لا يمكن أن يكون في المستقبل).
  * `incidentType` (String, إجباري): نوع الحادث (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
* **قواعد التحقق (Validation Rules):** يجب تقديم `policyNumber` أو `plateNumber` على الأقل. التاريخ بصيغة ISO تاريخية غير مستقبلية.
* **استجابة حقيقية (Real Response — 200 OK):**
```json
{
  "success": true,
  "message": "Policy verified successfully",
  "data": {
    "isEligible": true,
    "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-ELIGIBLE-001",
      "status": "ACTIVE",
      "startDate": "2025-01-01",
      "expiryDate": "2027-12-31",
      "policyType": "COMPREHENSIVE",
      "coveredPerils": [
        "COLLISION",
        "THEFT",
        "FIRE",
        "NATURAL_DISASTER"
      ],
      "deductibleAmount": 500
    },
    "coverage": {
      "policyType": "COMPREHENSIVE",
      "effectiveFrom": "2025-01-01",
      "effectiveTo": "2027-12-31",
      "deductible": 500,
      "incidents": [
        {
          "code": "COLLISION",
          "covered": true
        },
        {
          "code": "THEFT",
          "covered": true
        },
        {
          "code": "FIRE",
          "covered": true
        },
        {
          "code": "NATURAL_DISASTER",
          "covered": true
        }
      ]
    },
    "vehicle": {
      "id": "<VEHICLE_ID>",
      "plateNumber": "1234-A",
      "make": "Toyota",
      "model": "Corolla",
      "year": 2022,
      "color": "White"
    },
    "customer": {
      "id": "<CUSTOMER_ID>",
      "fullName": "Ahmad Contract",
      "phone": "0599112233"
    }
  }
}
```
* **قواعد الواجهة (UI Rules):**
  * عرض شارة `eligibilityHint` بناءً على جدول التسميات أدناه.
  * في حال الوثائق القديمة (Legacy)، تكون قيمة `coverage` مساوية لـ `null`.

---

### 2.2 شاشة إنشاء مطالبة (Claim Creation Screen)

* **المسار (Endpoint):** `POST /api/v1/claims`
* **المصادقة (Auth):** مطلوبة (`CLAIMS_OFFICER` أو `ADMIN`).
* **حقول الطلب (Request Fields):**
  * `policyId` (String, إجباري): معرف الوثيقة بصيغة MongoDB ObjectId.
  * `plateNumber` (String, اختياري): رقم لوحة المركبة (مطلوب إذا كانت الوثيقة تحتوي أكثر من مركبة).
  * `incidentType` (String, إجباري): أحد القيم (`COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`).
  * `incidentLocation` (String, إجباري): موقع الحادث نصياً.
  * `incidentDate` (String, إجباري, صيغة `YYYY-MM-DD`): تاريخ وقوع الحادث.
  * `description` (String, اختياري): تفاصيل إضافية عن الحادث (حد أقصى 1000 حرف).
  * `latitude` (Number, اختياري): إحداثي العرض الجغرافي بين -90 و 90.
  * `longitude` (Number, اختياري): إحداثي الطول الجغرافي بين -180 و 180.
* **استجابة حقيقية (Real Response — 201 Created):**
```json
{
  "success": true,
  "message": "Claim created successfully",
  "data": {
    "id": "<CLAIM_ID>",
    "claimNumber": "CLM-20261001-0001",
    "status": "NEW",
    "trackingToken": "<TRACKING_TOKEN_64_HEX>",
    "trackingUrl": "http://localhost:5173/track/<TRACKING_TOKEN_64_HEX>",
    "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
    "coverageSnapshot": {
      "policyType": "COMPREHENSIVE",
      "coveredPerils": [
        "COLLISION",
        "THEFT",
        "FIRE",
        "NATURAL_DISASTER"
      ],
      "deductibleAmount": 500,
      "capturedAt": "2026-10-01T12:53:10.000Z"
    },
    "createdAt": "2026-10-01T12:53:10.000Z"
  }
}
```
* **قواعد الواجهة (UI Rules):**
  * عرض رابط التتبع فور الإنشاء وإتاحة زر "نسخ الرابط" لمشاركته مع العميل.
  * يتم التقاط لقطة التغطية (`coverageSnapshot`) ثابتاً في لحظة الإنشاء ولا تتأثر بتعديل الوثيقة لاحقاً.

---

### 2.3 شاشة تفاصيل المطالبة (Claim Details Screen)

* **المسار (Endpoint):** `GET /api/v1/claims/:claimId`
* **المصادقة (Auth):** مطلوبة (حسب الدور).
* **استجابة موظف المطالبات والمسؤول (`CLAIMS_OFFICER` / `ADMIN`):**
  تحتوي على كافة الأقسام بما فيها `trackingToken` و `trackingUrl`:
```json
{
  "success": true,
  "message": "Claim retrieved successfully",
  "data": {
    "id": "<CLAIM_ID>",
    "claimNumber": "CLM-20261001-0001",
    "status": "NEW",
    "trackingToken": "<TRACKING_TOKEN_64_HEX>",
    "trackingUrl": "http://localhost:5173/track/<TRACKING_TOKEN_64_HEX>",
    "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
    "incidentDate": "2026-06-01",
    "incidentDescription": "Front bumper damage",
    "incidentType": "COLLISION",
    "incidentLocation": "Ramallah Main St",
    "incidentCoordinates": {
      "latitude": 31.9038,
      "longitude": 35.2034,
      "capturedAt": "2026-10-01T12:53:10.000Z"
    },
    "createdAt": "2026-10-01T12:53:10.000Z",
    "updatedAt": "2026-10-01T12:53:10.000Z",
    "customer": {
      "name": "Ahmad Contract",
      "phone": "0599112233"
    },
    "vehicle": {
      "plateNumber": "1234-A",
      "make": "Toyota",
      "model": "Corolla",
      "year": 2022,
      "color": "White"
    },
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-ELIGIBLE-001",
      "status": "ACTIVE",
      "startDate": "2025-01-01",
      "expiryDate": "2027-12-31"
    },
    "assignment": {
      "assignedTo": null,
      "assignedBy": null,
      "assignedAt": null,
      "priority": null,
      "assignmentNotes": null
    },
    "accident": null,
    "location": null,
    "evidence": [],
    "signature": null,
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
          "id": "<USER_ID>",
          "name": "Contract Officer",
          "employeeCode": "CT-OF-01",
          "role": "CLAIMS_OFFICER"
        },
        "role": "CLAIMS_OFFICER",
        "timestamp": "2026-10-01T12:53:10.000Z"
      }
    ],
    "createdBy": {
      "id": "<USER_ID>",
      "name": "Contract Officer",
      "employeeCode": "CT-OF-01"
    },
    "coverageSnapshot": {
      "policyType": "COMPREHENSIVE",
      "coveredPerils": [
        "COLLISION",
        "THEFT",
        "FIRE",
        "NATURAL_DISASTER"
      ],
      "deductibleAmount": 500,
      "capturedAt": "2026-10-01T12:53:10.000Z"
    },
    "lossAssessment": null
  }
}
```
* **استجابة المعاين الميداني (`FIELD_ADJUSTER`):**
  تتطابق تماماً مع ما سبق باستثناء غياب حقول التتبع `trackingToken` و `trackingUrl` لحماية خصوصية العميل.

---

### 2.4 نافذة اتخاذ القرار (Decision Modal)

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decision`
* **المصادقة (Auth):** مطلوبة (`CLAIMS_OFFICER` أو `ADMIN`).
* **حالة الرفض (REJECTED):**
  * حقول الطلب:
    * `decision`: `"REJECTED"`
    * `notes` (String, اختياري): ملاحظات وسبب الرفض.
    * `lossAssessment`: يُترك فارغاً (absent) أو تُرسل القيمة `null`. إرسال أي كائن يؤدي إلى `400 VALIDATION_ERROR`.
  * **استجابة الرفض (Real Response — 200 OK):**
    ```json
    {
      "success": true,
      "message": "Decision recorded successfully",
      "data": {
        "id": "<CLAIM_ID>",
        "claimNumber": "CLM-20261001-0002",
        "status": "REJECTED",
        "decisionNotes": "Not covered under policy conditions"
      }
    }
    ```
* **حالة الموافقة (APPROVED):**
  * حقول الطلب:
    * `decision`: `"APPROVED"`
    * `notes` (String, اختياري): ملاحظات القرار.
    * `lossAssessment` (Object, إجباري — إرسال null أو تركه فارغاً يُرجع خطأ 400):
      * `estimatedPartsCost` (Number, إجباري, >= 0)
      * `laborCost` (Number, إجباري, >= 0)
      * `deductibleApplied` (Number, اختياري, >= 0): إذا اختلف عن تحمل الوثيقة يعتبر تجاوزاً (Override).
      * `deductibleOverrideReason` (String, اختياري): إجباري (10 إلى 300 حرف) في حال تم تعديل مبلغ التحمل، ومحظور إذا تطابق مع تحمل الوثيقة.
  * **استجابة الموافقة (Real Response — 200 OK):**
    ```json
    {
      "success": true,
      "message": "Decision recorded successfully",
      "data": {
        "id": "<CLAIM_ID>",
        "claimNumber": "CLM-20261001-0003",
        "status": "APPROVED",
        "decisionNotes": "Claim verified and approved",
        "lossAssessment": {
          "estimatedPartsCost": 2000,
          "laborCost": 1000,
          "totalDamage": 3000,
          "policyDeductible": 500,
          "deductibleApplied": 500,
          "deductibleOverridden": false,
          "deductibleOverrideReason": null,
          "netApprovedPayout": 2500,
          "currency": "ILS",
          "assessedAt": "2026-10-01T12:53:11.000Z",
          "assessedBy": "<USER_ID>"
        }
      }
    }
    ```

---

### 2.5 صفحة التتبع العام للجمهور (Public Tracking Screen)

* **المسار (Endpoint):** `GET /api/v1/public/claims/track/:trackingToken`
* **المصادقة (Auth):** بدون مصادقة (Public — الرمز هو المفتاح الوحيد).
* **استجابة حقيقية (Real Response — 200 OK):**
```json
{
  "success": true,
  "message": "Claim status retrieved successfully",
  "data": {
    "claimNumber": "CLM-20261001-0001",
    "status": "RECEIVED",
    "statusDescription": "تم استلام بلاغك وهو قيد المعالجة",
    "vehicle": {
      "plateNumber": "ABC-xxx4",
      "make": "Toyota",
      "model": "Corolla",
      "year": 2022
    },
    "timeline": [
      {
        "status": "RECEIVED",
        "title": "تم استلام البلاغ",
        "description": "تم تسجيل البلاغ بنجاح وفتح ملف المطالبة في النظام",
        "timestamp": "2026-10-01T12:53:10.000Z"
      }
    ]
  }
}
```

---

## 3. جدول دلالات التحقق (eligibilityHint Label Map)

يجب على الواجهة الأمامية استخدام النصوص العربية التالية حرفياً لعرض شارة التوجيه الإرشادي:

| قيمة `eligibilityHint` | النص العربي المعتمد في الواجهة | نمط الواجهة (UI Style) |
| :--- | :--- | :--- |
| `ELIGIBLE_FOR_REVIEW` | الوثيقة سارية والحادث مشمول، جاهز للمراجعة | نجاح (Success / Green) |
| `NOT_COVERED_BY_POLICY_TYPE` | نوع الحادث غير مشمول بنوع الوثيقة | تحذير (Warning / Orange) |
| `INCIDENT_OUTSIDE_POLICY_PERIOD` | تاريخ الحادث خارج فترة سريان الوثيقة | تحذير (Warning / Orange) |
| `COVERAGE_UNKNOWN` | بيانات التغطية غير مكتملة، تحتاج المطالبة إلى مراجعة إدارية | تحذير (Warning / Yellow) |
| `null` | بدون شارة (No Badge) | محايد / مخفي |

> **قاعدة صارمة للواجهة الأمامية:**
> أي قيمة تختلف عن `ELIGIBLE_FOR_REVIEW` تُعرض بنمط تحذيري (**Warning Style**)، و**لا تمنع على الإطلاق** موظف التأمين من المتابعة وفتح المطالبة (`Never blocks claim creation`).

---

## 4. تعيين الحالات العامة للجمهور (Public Status Mapping)

يقوم النظام بتحويل الحالات الداخلية العشر (`Internal Statuses`) إلى ست حالات مبسطة للجمهور (`Public Statuses`):

| الحالة الداخلية (Internal Status) | الحالة العامة (Public Status) | العنوان في الخط الزمني (Timeline Title) | الوصف الموجه للعميل (Status Description) |
| :--- | :--- | :--- | :--- |
| `NEW` | `RECEIVED` | تم استلام البلاغ | تم استلام بلاغك وهو قيد المعالجة |
| `PENDING_ACCEPTANCE` | `RECEIVED` | تم استلام البلاغ | تم استلام بلاغك وهو قيد المعالجة |
| `ASSIGNED` | `RECEIVED` | تم استلام البلاغ | تم تعيين معاين لمطالبتك وسيباشر المعاينة قريباً |
| `IN_PROGRESS` | `IN_PROGRESS` | بدء المعاينة الميدانية | مركبتك قيد المعاينة الميدانية من قبل المفتش المختص |
| `CORRECTION_REQUIRED` | `IN_PROGRESS` | بدء المعاينة الميدانية | يجري استكمال بعض المعلومات على مطالبتك |
| `SUBMITTED` | `IN_REVIEW` | قيد المراجعة والتدقيق | ملف مطالبتك قيد المراجعة والتدقيق |
| `UNDER_REVIEW` | `IN_REVIEW` | قيد المراجعة والتدقيق | ملف مطالبتك قيد المراجعة والتدقيق |
| `APPROVED` | `APPROVED` | صدر القرار: موافقة | صدر القرار بالموافقة على مطالبتك |
| `REJECTED` | `REJECTED` | صدر القرار: رفض | صدر القرار برفض مطالبتك، يرجى مراجعة شركة التأمين للتفاصيل |
| `CLOSED` | `CLOSED` | تم الإغلاق والتسوية | تم إغلاق مطالبتك وإتمام التسوية |

---

## 5. دليل الأخطاء والرسائل المقترحة (Error Catalog)

تقوم الواجهة الأمامية بصياغة الرسائل بناءً على كود الخطأ (`code`) المستلم في كائن الخطأ:

| كود الحالة (HTTP) | كود الخطأ (`code`) | سبب الحدوث (Trigger) | الرسالة العربية المقترحة للواجهة |
| :---: | :--- | :--- | :--- |
| 422 | `POLICY_CANCELLED` | محاولة التحقق أو فتح مطالبة على وثيقة ملغاة | **الوثيقة ملغاة ولا يمكن فتح مطالبة عليها** |
| 422 | `DAMAGE_BELOW_DEDUCTIBLE` | إجمالي الضرر المحسوب أصغر أو يساوي مبلغ التحمل المطبق | **إجمالي الضرر يجب أن يكون أكبر من مبلغ التحمل المطبق** |
| 422 | `OVERRIDE_REASON_REQUIRED` | تعديل التحمل المطبق عن وثيقة التأمين دون تقديم سبب | **سبب تعديل التحمل مطلوب، من 10 إلى 300 حرفاً** |
| 422 | `OVERRIDE_REASON_NOT_ALLOWED` | تقديم سبب تعديل بينما التحمل يطابق تحمل الوثيقة | **لا يقبل سبب تعديل عندما يطابق التحمل تحمل الوثيقة** |
| 404 | `CLAIM_NOT_FOUND` | رمز التتبع غير موجود أو معرّف المطالبة خاطئ | **رمز المطالبة غير صحيح، يرجى التأكد من الرابط المرسل إليك** |
| 429 | `RATE_LIMIT_EXCEEDED` | تجاوز حد الطلبات المسموح به خلال النافذة الزمنية | **محاولات كثيرة، يرجى المحاولة بعد قليل** |
| 400 | `VALIDATION_ERROR` | فقدان حقول إجبارية مثل `incidentDate` أو صيغة خاطئة | يرجى التأكد من صحة الحقول المدخلة واكتمالها |
| 400 | `INVALID_INCIDENT_DATE` | تاريخ الحادث في المستقبل | لا يمكن أن يكون تاريخ الحادث في المستقبل |
| 404 | `POLICY_NOT_FOUND` | رقم الوثيقة غير مسجل في شركة التأمين | رقم الوثيقة غير موجود في سجلات الشركة |
| 404 | `VEHICLE_NOT_FOUND` | رقم اللوحة غير مسجل في النظام | لم يتم العثور على مركبة برقم اللوحة المدخل |
| 422 | `VEHICLE_MISMATCH` | المركبة المدخلة لا تتبع للوثيقة المحددة | رقم لوحة المركبة لا يتطابق مع هذه الوثيقة |
| 422 | `AMBIGUOUS_VEHICLE_SELECTION`| الوثيقة تضم أكثر من مركبة ولم يُحدد رقم اللوحة | الوثيقة تحتوي أكثر من مركبة، يرجى تحديد رقم اللوحة |
| 422 | `NO_VEHICLE_ON_POLICY` | لا توجد مركبات مسجلة تحت هذه الوثيقة | لا توجد أي مركبة مسجلة تحت هذه الوثيقة |
| 401 | `UNAUTHORIZED` | غياب التوكن أو انتهاء صلاحيته | انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول |
| 403 | `FORBIDDEN` | محاولة الوصول لبيانات خارج صلاحيات الدور | ليس لديك الصلاحية للقيام بهذا الإجراء |

---

## 6. قواعد صفحة التتبع العام (Public Tracking Page Rules)

1. **مسار الصفحة (Route):** يتم بناء المسار في تطبيق الفرونت إند بالشكل: `/track/:trackingToken`.
2. **وسوم الحماية ومحركات البحث (SEO & Security Tags):**
   * يجب وضع وسم منع الفهرسة: `<meta name="robots" content="noindex, nofollow" />`.
   * يجب تفعيل سياسة الإحالة: `<meta name="referrer" content="no-referrer" />`.
3. **تكرار الاستعلام (Polling Rate):**
   * يُمنع عمل استعلام دوري (Polling) بمعدل أقل من **30 ثانية** بين كل طلب وآخر لتجنب استهلاك معدل الطلبات.
4. **التعامل مع الأخطاء (404 و 429):**
   * عند تلقي `404 CLAIM_NOT_FOUND`: إيقاف الـ Polling فوراً وعرض شاشة تفيد بأن الرابط غير صالح.
   * عند تلقي `429 RATE_LIMIT_EXCEEDED`: إيقاف الـ Polling مؤقتاً لمدة 60 ثانية وإظهار رسالة تنبيه للمستخدم.
5. **معالجة غياب عنوان الخادم (Handling null `trackingUrl`):**
   * عندما يكون المتغير `PUBLIC_FRONTEND_URL` غير معين في الخادم، ستكون قيمة `trackingUrl` العائدة في الاستجابة `null`.
   * على الفرونت إند بناء الرابط محلياً بالاعتماد على الـ Origin الحالي ورمز المطالبة: `${window.location.origin}/track/${trackingToken}`.

---

## 7. قواعد نافذة اتخاذ القرار (Approval Modal Rules)

1. **نطاق القيم وصيغتها (Value Ranges & Decimals):**
   * جميع المبالغ المالية (`estimatedPartsCost`, `laborCost`, `deductibleApplied`) يجب أن تكون أرقاماً موجبة (>= 0) بحد أقصى خانتين عشريتين (Two Decimals).
2. **قواعد تعديل التحمل (Override Logic):**
   * حقل `deductibleApplied` اختياري، وقيمته الافتراضية تساوي تحمل الوثيقة (`policyDeductible`).
   * إذا قام المستخدم بتعديل قيمة التحمل إلى قيمة مختلفة، يصبح حقل "سبب التعديل" (`deductibleOverrideReason`) إجبارياً من 10 إلى 300 حرفاً.
   * إذا تطابقت القيمة مع تحمل الوثيقة، يُمنع إرسال سبب التعديل.
3. **الحسابات المالية (Server-Computed Financials):**
   * يمكن للواجهة الأمامية تقديم معاينة فورية للحسابات (`Preview`):
     * $\text{totalDamage} = \text{estimatedPartsCost} + \text{laborCost}$
     * $\text{netApprovedPayout} = \text{totalDamage} - \text{deductibleApplied}$
   * **القيمة المعتمدة قطيعاً هي القيمة المحسوبة بواسطة السيرفر** في الاستجابة (Server calculation wins).
   * يُشترط أن يكون $\text{totalDamage} > \text{deductibleApplied}$، وإلا سيرفض السيرفر الطلب برمز `422 DAMAGE_BELOW_DEDUCTIBLE`.
4. **العملة (Currency):**
   * يتم استخدام رمز العملة المرتجع في حقل `currency` من الاستجابة (مثل `ILS`)، ولا يتم تثبيت العملة يدوياً في الكود.
