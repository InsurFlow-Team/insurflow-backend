# وثيقة تسليم ومواءمة واجهات المستخدم الأمامية (Frontend Handoff & Contract Alignment)

هذه الوثيقة موجهة لفريق تطوير الواجهات الأمامية (Frontend Team) لتوضيح التغييرات والاتفاقيات البرمجية لنقاط النهاية، التحقق، شاشات فتح ومتابعة المطالبات، واتخاذ القرار في نظام **InsurFlow**.

> **ملاحظة هامة بشأن الرسائل (`message` strings):**
> نصوص الرسائل (`message`) المرجعة في استجابات النجاح أو الخطأ هي نصوص توضيحية خاضعة للتغيير والتحسين، ويجب على الواجهة الأمامية عدم الاعتماد برمجياً على محتواها النصي، بل الاعتماد حصرياً على كود الخطأ (`error.code`) وحالة HTTP (`status code`) لإدارة تدفق العمل وعرض الرسائل المترجمة للمستخدمين.

---

## 1. التغييرات المؤثرة على العملاء والواجهات (Client-Facing Changes)

1. **`incidentDate` إجباري في إنشاء المطالبة واختياري في التحقق:**
   * في نقطة إنشاء المطالبة (`POST /claims`): الحقل **إجباري** بصيغة `YYYY-MM-DD`.
   * في نقطة التحقق من الوثيقة (`POST /policies/verify`): الحقل **اختياري** (يُعتمد تاريخ اليوم تلقائياً عند غيابه).
2. **`plateNumber` اختياري في إنشاء المطالبة:**
   * حقل `plateNumber` اختياري إذا كانت الوثيقة مرتبطة بمركبة واحدة فقط، حيث يتم جلب بيانات المركبة تلقائياً من الوثيقة.
3. **قائمة أنواع الحوادث (`incidentType` Enum):**
   * عند إنشاء المطالبة أو تحديث الحادث: يقبل النظام 8 أنواع (`COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
   * عند التحقق من الوثيقة (`POST /policies/verify`): يقبل النظام 4 أخطار تأمينية (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
4. **صيغة رقم المطالبة (`claimNumber`):**
   * يتم توليد أرقام المطالبات بالصيغة القياسية: `CLM-YYYYMMDD-XXXX` (مثل: `CLM-20261001-0001`).
5. **`description` اختياري (Optional):**
   * حقل وصف الحادث اختياري بحد أقصى 1000 حرف ويُخزن كـ `incidentDescription`.
6. **إحداثيات مسطحة (Flat Latitude & Longitude):**
   * يتم إرسال الإحداثيات كحقول رقمية مسطحة `latitude` (-90 إلى 90) و `longitude` (-180 إلى 180).
7. **سلوك التحقق من الوثيقة (Policy Verification):**
   * كل وثيقة غير ملغاة تُرجع حالة نجاح `200 OK` مع `isEligible: true`.
   * الفروقات الزمنية أو عدم تغطية الخطر تظهر عبر كود التوجيه `eligibilityHint`.
   * فقط الوثيقة الملغاة تُرجع خطأ `422 POLICY_CANCELLED`.
8. **هيكل استجابة التتبع العام (Public Tracking Response):**
   * يقتصر على: `claimNumber`, `status`, `statusDescription`, `vehicle` (مع قناع للوحة), و `timeline` تصاعدي.
9. **حجب أرقام اللوحات للجمهور (Plate Masking):**
   * يُعرض رقم اللوحة في التتبع العام بصيغة محجوبة لحماية الخصوصية (مثال: `CAP-xxx1` أو `ABC-xxx4`).
10. **تقييد صلاحية الوصول إلى رمز التتبع (trackingToken Restriction):**
    * يظهر `trackingToken` و `trackingUrl` فقط للمسؤولين (`ADMIN`) وموظفي المطالبات (`CLAIMS_OFFICER`). يُحجب الحقلان تماماً عن المعاين الميداني (`FIELD_ADJUSTER`).
11. **تقييم الأضرار إلزامي للموافقة (lossAssessment Mandatory for Approvals):**
    * حقل `lossAssessment` إلزامي عند اتخاذ قرار الموافقة `APPROVED`.
    * يُحظر إرسال كائن فيه عند الرفض `REJECTED` (يُقبل غيابه أو القيمة `null` فقط).

---

## 2. تفاصيل الشاشات ونقاط النهاية (Screen-by-Screen Specifications)

### 2.1 شاشة التحقق من الوثيقة (Policy Verification Screen)

* **المسار (Endpoint):** `POST /api/v1/policies/verify`
* **المصادقة (Auth):** مطلوبة (Bearer Token — موظف مطالبات أو مسؤول).
* **حقول الطلب (Request Fields):**
  * `policyNumber` (String, اختياري إذا أُرسل plateNumber): رقم الوثيقة.
  * `plateNumber` (String, اختياري إذا أُرسل policyNumber): رقم لوحة المركبة للمطابقة.
  * `incidentDate` (String, اختياري, صيغة `YYYY-MM-DD`): تاريخ الحادث (يُفترض اليوم في حال عدم الإرسال).
  * `incidentType` (String, إجباري): أحد الأخطار المغطاة (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
* **استجابة حقيقية لوثيقة مؤهلة (Real Response — Eligible Policy — 200 OK):**
```json
{
  "success": true,
  "message": "Policy verified successfully",
  "data": {
    "isEligible": true,
    "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-CAP-001",
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
      "plateNumber": "CAP-111",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022,
      "color": "White"
    },
    "customer": {
      "id": "<CUSTOMER_ID>",
      "fullName": "Capture User",
      "phone": "<PHONE>"
    }
  }
}
```

* **استجابة حقيقية لوثيقة قديمة بدون بيانات تفصيلية (Real Response — Legacy Policy — 200 OK):**
```json
{
  "success": true,
  "message": "Policy verified successfully",
  "data": {
    "isEligible": true,
    "eligibilityHint": "COVERAGE_UNKNOWN",
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-CAP-LEG",
      "status": "ACTIVE",
      "startDate": "2025-01-01",
      "expiryDate": "2027-12-31",
      "policyType": null,
      "coveredPerils": [],
      "deductibleAmount": null
    },
    "coverage": null,
    "vehicle": {
      "id": "<VEHICLE_ID>",
      "plateNumber": "CAP-222",
      "make": "Honda",
      "model": "Civic",
      "year": 2021,
      "color": "Silver"
    },
    "customer": {
      "id": "<CUSTOMER_ID>",
      "fullName": "Capture User",
      "phone": "<PHONE>"
    }
  }
}
```

* **استجابة حقيقية لحادث خارج فترة السريان (Real Response — Incident Outside Period — 200 OK):**
```json
{
  "success": true,
  "message": "Policy verified successfully",
  "data": {
    "isEligible": true,
    "eligibilityHint": "INCIDENT_OUTSIDE_POLICY_PERIOD",
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-CAP-001",
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
      "plateNumber": "CAP-111",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022,
      "color": "White"
    },
    "customer": {
      "id": "<CUSTOMER_ID>",
      "fullName": "Capture User",
      "phone": "<PHONE>"
    }
  }
}
```

---

### 2.2 شاشة إنشاء مطالبة (Claim Creation Screen)

* **المسار (Endpoint):** `POST /api/v1/claims`
* **المصادقة (Auth):** مطلوبة (`CLAIMS_OFFICER` أو `ADMIN`).
* **حقول الطلب (Request Fields):**
  * `policyId` (String, إجباري): معرف الوثيقة بصيغة MongoDB ObjectId.
  * `plateNumber` (String, اختياري): رقم لوحة المركبة (مطلوب فقط إذا كانت الوثيقة تضم أكثر من مركبة واحدة).
  * `incidentType` (String, إجباري): أحد الأنواع الثمانية:
    `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`, `THEFT`, `FIRE`, `NATURAL_DISASTER`.
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
    "incidentId": "<INCIDENT_ID>",
    "incidentNumber": "INC-20261001-0001",
    "claimType": "OWN_DAMAGE",
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
      "capturedAt": "<TIMESTAMP>"
    },
    "createdAt": "<TIMESTAMP>"
  }
}
```
* **ملاحظات الحقول:**
  * `incidentId`: معرّف الحادث الأب، وقيمته null للمطالبات القديمة
  * `incidentNumber`: رقم الحادث، وقيمته null للمطالبات القديمة
  * `claimType`: نوع المطالبة، وحالياً دائماً OWN_DAMAGE

---

### 2.3 شاشة تفاصيل المطالبة (Claim Details Screen)

* **المسار (Endpoint):** `GET /api/v1/claims/:claimId`
* **المصادقة (Auth):** مطلوبة (حسب الدور).
* **استجابة موظف المطالبات والمسؤول (`CLAIMS_OFFICER` / `ADMIN`) مع الخط الزمني للمطالبة الجديدة:**
```json
{
  "success": true,
  "message": "Claim retrieved successfully",
  "data": {
    "id": "<CLAIM_ID>",
    "claimNumber": "CLM-20261001-0001",
    "incidentId": "<INCIDENT_ID>",
    "incidentNumber": "INC-20261001-0001",
    "claimType": "OWN_DAMAGE",
    "status": "NEW",
    "trackingToken": "<TRACKING_TOKEN_64_HEX>",
    "trackingUrl": "http://localhost:5173/track/<TRACKING_TOKEN_64_HEX>",
    "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
    "incidentDate": "2026-06-15",
    "incidentDescription": null,
    "incidentType": "COLLISION",
    "incidentLocation": "Main Road",
    "incidentCoordinates": null,
    "createdAt": "<TIMESTAMP>",
    "updatedAt": "<TIMESTAMP>",
    "customer": {
      "name": "Capture User",
      "phone": "<PHONE>"
    },
    "vehicle": {
      "plateNumber": "CAP-111",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022,
      "color": "White"
    },
    "policy": {
      "id": "<POLICY_ID>",
      "policyNumber": "POL-CAP-001",
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
          "name": "Officer User",
          "employeeCode": "OF-CAP-01",
          "role": "CLAIMS_OFFICER"
        },
        "role": "CLAIMS_OFFICER",
        "timestamp": "<TIMESTAMP>"
      }
    ],
    "createdBy": {
      "id": "<USER_ID>",
      "name": "Officer User",
      "employeeCode": "OF-CAP-01"
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
      "capturedAt": "<TIMESTAMP>"
    },
    "lossAssessment": null
  }
}
```
* **استجابة المعاين الميداني (`FIELD_ADJUSTER`):**
  تتطابق تماماً مع ما سبق، مع حجب كامل لحقلي `trackingToken` و `trackingUrl`.
* **ملاحظات الحقول:**
  * `incidentId`: معرّف الحادث الأب، وقيمته null للمطالبات القديمة
  * `incidentNumber`: رقم الحادث، وقيمته null للمطالبات القديمة
  * `claimType`: نوع المطالبة، وحالياً دائماً OWN_DAMAGE

---

### 2.4 نافذة اتخاذ القرار (Decision Modal)

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decision`
* **المصادقة (Auth):** مطلوبة (`CLAIMS_OFFICER` أو `ADMIN`).
* **حالة الموافقة (APPROVED) مع تعديل التحمل (Override):**
  * حقول الطلب:
    * `decision`: `"APPROVED"`
    * `notes` (String, اختياري): ملاحظات القرار.
    * `lossAssessment` (Object, إجباري):
      * `estimatedPartsCost` (Number, إجباري, >= 0)
      * `laborCost` (Number, إجباري, >= 0)
      * `deductibleApplied` (Number, اختياري, >= 0)
      * `deductibleOverrideReason` (String, إجباري في حال تعديل التحمل من 10 إلى 300 حرف، ومحظور إذا تطابق مع تحمل الوثيقة)
  * **استجابة حقيقية للموافقة مع Override (Real Response — 200 OK):**
```json
{
  "success": true,
  "message": "Decision recorded successfully",
  "data": {
    "id": "<CLAIM_ID>",
    "claimNumber": "CLM-20261001-0001",
    "status": "APPROVED",
    "decisionNotes": "Approved with management override",
    "lossAssessment": {
      "estimatedPartsCost": 1500,
      "laborCost": 800,
      "totalDamage": 2300,
      "policyDeductible": 500,
      "deductibleApplied": 300,
      "deductibleOverridden": true,
      "deductibleOverrideReason": "Commercial gesture approved by director",
      "netApprovedPayout": 2000,
      "currency": "ILS",
      "assessedAt": "<TIMESTAMP>",
      "assessedBy": "<USER_ID>"
    }
  }
}
```

* **حالة الرفض (REJECTED):**
  * حقول الطلب:
    * `decision`: `"REJECTED"`
    * `notes` (String, اختياري): سبب الرفض.
    * `lossAssessment`: يُترك فارغاً أو يُرسل `null` (إرسال كائن يُرجع `400 VALIDATION_ERROR`).
  * **استجابة حقيقية للرفض (Real Response — 200 OK):**
```json
{
  "success": true,
  "message": "Decision recorded successfully",
  "data": {
    "id": "<CLAIM_ID>",
    "claimNumber": "CLM-20261001-0001",
    "status": "REJECTED",
    "decisionNotes": "Damage not covered under policy terms"
  }
}
```

---

### 2.5 صفحة التتبع العام للجمهور (Public Tracking Screen)

* **المسار (Endpoint):** `GET /api/v1/public/claims/track/:trackingToken`
* **المصادقة (Auth):** بدون مصادقة (Public).
* **استجابة حقيقية لمطالبة جديدة (Real Response — New Claim — 200 OK):**
```json
{
  "success": true,
  "message": "Claim status retrieved successfully",
  "data": {
    "claimNumber": "CLM-20261001-0001",
    "status": "RECEIVED",
    "statusDescription": "تم استلام بلاغك وهو قيد المعالجة",
    "vehicle": {
      "plateNumber": "CAP-xxx1",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022
    },
    "timeline": [
      {
        "status": "RECEIVED",
        "title": "تم استلام البلاغ",
        "description": "تم تسجيل البلاغ بنجاح وفتح ملف المطالبة في النظام",
        "timestamp": "<TIMESTAMP>"
      }
    ]
  }
}
```

* **استجابة حقيقية لمطالبة معتمدة (Real Response — Approved Claim — 200 OK):**
```json
{
  "success": true,
  "message": "Claim status retrieved successfully",
  "data": {
    "claimNumber": "CLM-20261001-0001",
    "status": "APPROVED",
    "statusDescription": "صدر القرار بالموافقة على مطالبتك",
    "vehicle": {
      "plateNumber": "CAP-xxx1",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022
    },
    "timeline": [
      {
        "status": "RECEIVED",
        "title": "تم استلام البلاغ",
        "description": "تم تسجيل البلاغ بنجاح وفتح ملف المطالبة في النظام",
        "timestamp": "<TIMESTAMP>"
      },
      {
        "status": "APPROVED",
        "title": "صدر القرار: موافقة",
        "description": "صدر القرار بالموافقة على مطالبتك",
        "timestamp": "<TIMESTAMP>"
      }
    ]
  }
}
```

* **استجابة حقيقية عند عدم وجود المطالبة (Real Response — 404 Not Found):**
```json
{
  "success": false,
  "error": {
    "code": "CLAIM_NOT_FOUND",
    "message": "Claim not found for this tracking token"
  }
}
```

* **استجابة حقيقية عند تجاوز معدل الطلبات (Real Response — 429 Too Many Requests):**
```json
{
  "success": false,
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Too many requests from this IP, please try again after 15 minutes"
  }
}
```

---

### 2.6 شاشات إدارة الحوادث والمطالبات الفرعية (Incident Endpoints & Sub-claims)

#### 1. تسجيل حادث جديد (Open Incident)
* **المسار (Endpoint):** `POST /api/v1/incidents`
* **الأدوار المصرح لها:** `CLAIMS_OFFICER`, `ADMIN` (المعاين `FIELD_ADJUSTER` يتلقى 403).
* **جسم الطلب (Request Body):**
```json
{
  "incidentDate": "2026-06-15",
  "incidentType": "COLLISION",
  "incidentLocation": "Al-Irsal St, Ramallah",
  "description": "Front collision with barrier",
  "latitude": 31.9050,
  "longitude": 35.2040
}
```
* **استجابة النجاح (201 Created):**
```json
{
  "success": true,
  "message": "Incident created successfully",
  "data": {
    "id": "<INCIDENT_ID>",
    "incidentNumber": "INC-20261001-0001",
    "incidentDate": "2026-06-15",
    "incidentType": "COLLISION",
    "incidentLocation": "Al-Irsal St, Ramallah",
    "incidentDescription": "Front collision with barrier",
    "incidentCoordinates": {
      "latitude": 31.9050,
      "longitude": 35.2040,
      "capturedAt": "2026-06-15T10:00:00.000Z"
    },
    "createdAt": "2026-06-15T10:00:00.000Z"
  }
}
```

#### 2. استعراض قائمة الحوادث مع الترقيم والفلترة (List Incidents)
* **المسار (Endpoint):** `GET /api/v1/incidents`
* **معاملات الاستعلام (Query Parameters):**
  * `page`: رقم الصفحة (الافتراضي: 1).
  * `limit`: عدد السجلات في الصفحة (الافتراضي: 50، الأقصى: 100).
  * `incidentNumber`: فلترة برقم الحادث المطابق.
  * `from`: تاريخ البداية بصيغة `YYYY-MM-DD` لفلترة `incidentDate`.
  * `to`: تاريخ النهاية بصيغة `YYYY-MM-DD` لفلترة `incidentDate`.
* **ترويسات الاستجابة (Pagination Headers):**
  * `X-Total-Count`: إجمالي عدد الحوادث المطابقة في المؤسسة.
  * `X-Page`: الصفحة الحالية.
  * `X-Limit`: عدد العناصر في الصفحة.
  * `X-Total-Pages`: إجمالي عدد الصفحات.
* **استجابة النجاح (200 OK):**
```json
{
  "success": true,
  "message": "Incidents retrieved successfully",
  "data": [
    {
      "id": "<INCIDENT_ID>",
      "incidentNumber": "INC-20261001-0001",
      "incidentDate": "2026-06-15",
      "incidentType": "COLLISION",
      "incidentLocation": "Al-Irsal St, Ramallah",
      "createdAt": "2026-06-15T10:00:00.000Z"
    }
  ]
}
```

#### 3. تفاصيل الحادث والمطالبات المرتبطة (Incident Details & Sub-claims)
* **المسار (Endpoint):** `GET /api/v1/incidents/:incidentId`
* **استجابة النجاح (200 OK):**
```json
{
  "success": true,
  "message": "Incident retrieved successfully",
  "data": {
    "id": "<INCIDENT_ID>",
    "incidentNumber": "INC-20261001-0001",
    "incidentDate": "2026-06-15",
    "incidentType": "COLLISION",
    "incidentLocation": "Al-Irsal St, Ramallah",
    "incidentDescription": "Front collision with barrier",
    "incidentCoordinates": {
      "latitude": 31.9050,
      "longitude": 35.2040,
      "capturedAt": "2026-06-15T10:00:00.000Z"
    },
    "createdAt": "2026-06-15T10:00:00.000Z",
    "claims": [
      {
        "id": "<CLAIM_ID>",
        "claimNumber": "CLM-20261001-0001",
        "claimType": "OWN_DAMAGE",
        "status": "NEW",
        "plateNumber": "ABC-1234"
      }
    ]
  }
}
```

#### 4. إنشاء مطالبة فرعية وربطها بالحادث (Create Sub-claim)
* **المسار (Endpoint):** `POST /api/v1/incidents/:incidentId/claims`
* **جسم الطلب (Request Body):**
```json
{
  "claimType": "OWN_DAMAGE",
  "policyId": "<POLICY_ID>",
  "plateNumber": "ABC-1234"
}
```
* **قواعد العمل وحماية التكرار (Duplicate Guard):**
  * يتم نسخ وقائع الحادث تلقائياً من وثيقة الحادث الأصلية ولا تُرسل في الطلب.
  * نوع المطالبة `THIRD_PARTY_PD` مغلق حالياً ويرجع `422 CLAIM_TYPE_NOT_SUPPORTED`.
  * حماية التكرار تمنع إنشاء أكثر من مطالبة `OWN_DAMAGE` واحدة لنفس المركبة في نفس الحادث وتُرجع `409 DUPLICATE_SUB_CLAIM`.
* **استجابة النجاح (201 Created):**
  تتطابق مفاتيح الاستجابة تماماً مع استجابة إنشاء المطالبة `POST /claims`.

---

### 2.7 إحصائيات لوحة التحكم — إجمالي الحوادث (Dashboard Stats)
* **المسار (Endpoint):** `GET /api/v1/claims/stats`
* **التحديث في PB-01b:**
  * تمت إضافة حقل `totalIncidents` في استجابة نطاق المؤسسة (`scope: ORGANIZATION`) لمسؤولي المطالبات والمديرين (`CLAIMS_OFFICER` و `ADMIN`).
  * يتم تطبيق فلاتر `from` و `to` على تاريخ إنشاء الحادث `Incident.createdAt` بنفس آلية المطالبات.
  * استجابة المعاين الميداني (`FIELD_ADJUSTER`) تظل كما هي بنطاق `ASSIGNED` دون إضافة حقل `totalIncidents`.
```json
{
  "success": true,
  "message": "Claim statistics retrieved successfully",
  "data": {
    "scope": "ORGANIZATION",
    "totalClaims": 13,
    "totalIncidents": 5,
    "byStatus": { ... },
    "pendingActionCount": 4,
    "actionableBreakdown": { ... },
    "adjustersWorkload": { ... }
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

## 5. دليل الأخطاء (Error Catalog)

تقوم الواجهة الأمامية بصياغة الرسائل بناءً على كود الخطأ (`error.code`) وحالة HTTP:

| كود الحالة (HTTP) | كود الخطأ (`code`) | سبب الحدوث (Trigger) | الرسالة العربية المقترحة للواجهة |
| :---: | :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` | فقدان حقول إجبارية أو صيغة غير صالحة | يرجى التأكد من صحة الحقول المدخلة واكتمالها |
| 400 | `INVALID_INCIDENT_DATE` | تاريخ الحادث في المستقبل | لا يمكن أن يكون تاريخ الحادث في المستقبل |
| 401 | `UNAUTHORIZED` | غياب التوكن أو انتهاء صلاحيته | انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول |
| 403 | `FORBIDDEN` | محاولة الوصول لبيانات خارج صلاحيات الدور | ليس لديك الصلاحية للقيام بهذا الإجراء |
| 404 | `CLAIM_NOT_FOUND` | رمز التتبع غير موجود أو معرّف المطالبة خاطئ | رمز المطالبة غير صحيح، يرجى التأكد من الرابط المرسل إليك |
| 404 | `POLICY_NOT_FOUND` | رقم الوثيقة غير مسجل في شركة التأمين | رقم الوثيقة غير موجود في سجلات الشركة |
| 404 | `VEHICLE_NOT_FOUND` | رقم اللوحة غير مسجل في النظام | لم يتم العثور على مركبة برقم اللوحة المدخل |
| 404 | `CUSTOMER_NOT_FOUND` | العميل غير موجود في النظام | لم يتم العثور على العميل المطلوب |
| 404 | `USER_NOT_FOUND` | المستخدم أو الموظف غير موجود | لم يتم العثور على المستخدم المطلوب |
| 404 | `INCIDENT_NOT_FOUND` | الحادث غير موجود في سجلات الشركة أو يتبع لمؤسسة أخرى | الحادث غير موجود |
| 404 | `RESOURCE_NOT_FOUND` | المسار أو المورد المطلوب غير موجود | المورد المطلوب غير موجود |
| 409 | `INVALID_STATUS_TRANSITION` | محاولة تغيير حالة المطالبة لمسار غير مسموح | لا يمكن تنفيذ هذا الإجراء في حالة المطالبة الحالية |
| 409 | `CLAIM_ALREADY_EXISTS` | فتح مطالبة مكررة لنفس الحادث أو الوثيقة | توجد مطالبة سابقة مسجلة بالفعل |
| 409 | `DUPLICATE_SUB_CLAIM` | فتح مطالبة أضرار ذاتية ثانية لنفس المركبة في نفس الحادث | توجد مطالبة أضرار ذاتية لهذه المركبة في هذا الحادث |
| 422 | `POLICY_CANCELLED` | محاولة التحقق أو فتح مطالبة على وثيقة ملغاة | الوثيقة ملغاة ولا يمكن فتح مطالبة عليها |
| 422 | `POLICY_MISMATCH` | الوثيقة المرسلة لا تطابق وثيقة المطالبة | الوثيقة المرسلة لا تطابق وثيقة المطالبة |
| 422 | `VEHICLE_NOT_ON_CLAIM_POLICY` | المركبة غير مسجلة على وثيقة هذه المطالبة | المركبة غير مسجلة على وثيقة هذه المطالبة |
| 422 | `CUSTOMER_NOT_ON_VEHICLE` | العميل ليس المالك المسجل لهذه المركبة | العميل ليس المالك المسجل لهذه المركبة |
| 422 | `DAMAGE_BELOW_DEDUCTIBLE` | إجمالي الضرر المحسوب أصغر أو يساوي مبلغ التحمل المطبق | إجمالي الضرر يجب أن يكون أكبر من مبلغ التحمل المطبق |
| 422 | `OVERRIDE_REASON_REQUIRED` | تعديل التحمل المطبق عن وثيقة التأمين دون تقديم سبب | سبب تعديل التحمل مطلوب، من 10 إلى 300 حرفاً |
| 422 | `OVERRIDE_REASON_NOT_ALLOWED` | تقديم سبب تعديل بينما التحمل يطابق تحمل الوثيقة | لا يقبل سبب تعديل عندما يطابق التحمل تحمل الوثيقة |
| 422 | `VEHICLE_MISMATCH` | المركبة المدخلة لا تتبع للوثيقة المحددة | رقم لوحة المركبة لا يتطابق مع هذه الوثيقة |
| 422 | `AMBIGUOUS_VEHICLE_SELECTION`| الوثيقة تضم أكثر من مركبة ولم يُحدد رقم اللوحة | الوثيقة تحتوي أكثر من مركبة، يرجى تحديد رقم اللوحة |
| 422 | `NO_VEHICLE_ON_POLICY` | لا توجد مركبات مسجلة تحت هذه الوثيقة | لا توجد أي مركبة مسجلة تحت هذه الوثيقة |
| 422 | `CLAIM_TYPE_NOT_SUPPORTED` | محاولة إنشاء مطالبة من نوع الطرف الثالث قبل تفعيلها | مطالبات الطرف الثالث غير متاحة حالياً |
| 429 | `TOO_MANY_REQUESTS` | تجاوز حد الطلبات المسموح به خلال النافذة الزمنية | محاولات كثيرة، يرجى المحاولة بعد 15 دقيقة |
| 500 | `INTERNAL_SERVER_ERROR` | خطأ غير متوقع في الخادم | حدث خطأ داخلي، يرجى المحاولة لاحقاً |

---

## 6. قواعد صفحة التتبع العام (Tracking Page Rules)

1. **مسار الصفحة (Route):**
   * يتم بناء المسار في تطبيق الواجهة الأمامية بالصيغة: `/track/:trackingToken`.
2. **وسم منع الفهرسة (noindex meta tag):**
   * يجب وضع الوسم التالي في ترويسة الصفحة لمنع محركات البحث من الفهرسة:
     `<meta name="robots" content="noindex, nofollow" />`
3. **سياسة الإحالة (Referrer Policy):**
   * يجب تفعيل سياسة منع نقل الإحالة لحماية خصوصية العميل:
     `<meta name="referrer" content="no-referrer" />`
4. **تكرار الاستعلام الدوري (Polling Interval):**
   * يُمنع تنفيذ الاستعلام الدوري (Polling) بمعدل أسرع من **مرة كل 30 ثانية** (Polling no faster than every 30 seconds).
5. **التعامل مع الأخطاء (404 و 429):**
   * عند استقبال خطأ `404 CLAIM_NOT_FOUND`: إيقاف الاستعلام الدوري فوراً وعرض شاشة واضحة للمستخدم تفيد بأن الرابط غير صالح أو انتهت صلاحيته.
   * عند استقبال خطأ `429 TOO_MANY_REQUESTS`: إيقاف الاستعلام الدوري مؤقتاً وعرض رسالة تنبيه للمستخدم بالانتظار قبل إعادة المحاولة.
6. **معالجة القيمة الفارغة لـ `trackingUrl` (Null Tracking URL Handling):**
   * عندما يكون متغير البيئة `PUBLIC_FRONTEND_URL` غير معين في الخادم، تُرجع نقطة النهاية `trackingUrl: null`.
   * على تطبيق الواجهة الأمامية بناء الرابط محلياً بالاعتماد على النطاق الحالي للعميل:
     `${window.location.origin}/track/${trackingToken}`

---

## 7. قواعد نافذة اتخاذ القرار (Approval Modal Rules)

1. **نطاق القيم وصيغتها (Value Ranges & Decimals):**
   * جميع المبالغ المالية (`estimatedPartsCost`, `laborCost`, `deductibleApplied`) يجب أن تكون أرقاماً غير سالبة (>= 0).
   * يُسمح بحد أقصى خانتين عشريتين فقط (Two Decimals).
2. **قواعد تعديل التحمل (Override Rule):**
   * حقل `deductibleApplied` اختياري، وقيمته الافتراضية تساوي تحمل الوثيقة (`policyDeductible`).
   * إذا تم إدخال قيمة تختلف عن تحمل الوثيقة (`deductibleApplied !== policyDeductible`)، يُشترط إرسال سبب التعديل `deductibleOverrideReason` بنص يتراوح بين 10 و 300 حرف.
   * إذا تطابقت القيمة مع تحمل الوثيقة (`deductibleApplied === policyDeductible`)، يُحظر إرسال حقل سبب التعديل (أو إرساله `null`).
3. **المجاميع المحسوبة من الخادم (Server-Computed Totals):**
   * يمكن للواجهة الأمامية عرض مجاميع تقديرية استرشادية:
     * $\text{totalDamage} = \text{estimatedPartsCost} + \text{laborCost}$
     * $\text{netApprovedPayout} = \text{totalDamage} - \text{deductibleApplied}$
   * الحسابات النهائية المعتمدة هي المحسوبة حصرياً بواسطة الخادم ومُرجعة في الاستجابة (Server calculation is authoritative).
   * يشترط أن يكون $\text{totalDamage} > \text{deductibleApplied}$ وإلا يُرفض الطلب بكود `422 DAMAGE_BELOW_DEDUCTIBLE`.
4. **العملة (Currency):**
   * يجب استخراج رمز العملة ديناميكياً من حقل `lossAssessment.currency` في الاستجابة (مثل `ILS`)، مع تجنب تثبيت العملة نصياً في الواجهة.

---

## 8. ملاحظة حول مشاركة الموارد عبر الأصول (CORS Note)

* يتم حماية نقاط النهاية ضد طلبات المتصفح غير المصرح بها عبر سياسة CORS.
* يجب أن يتطابق نطاق تطبيق الواجهة الأمامية (`Origin` الخاص بالمتصفح، مثال: `http://localhost:5173` أو `https://portal.insurflow.com`) مع النطاقات المعرفة ضمن متغير البيئة `CORS_ORIGIN` في خادم الواجهة الخلفية.
