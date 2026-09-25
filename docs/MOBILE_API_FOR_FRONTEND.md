# دليل واجهات وبرمجة تطبيق الموبايل (Mobile API Documentation for Flutter / Mobile Developers)

يقدم هذا الدليل المرجع الشامل والنهائي لمطور تطبيقات الموبايل (**Flutter / Mobile Developer**) لربط وبرمجة جميع وظائف تطبيق مساح الحوادث الميداني (**Field Adjuster**) في منصة **InsurFlow**، مع التركيز الخاص على متطلبات رفع الصور والتوقيع الرقمي بصيغة `multipart/form-data`.

---

## 📌 معلومات أساسية لمطور الموبايل (Core Information)

* **Base URL (Local / Emulators):**
  * Android Emulator: `http://10.0.2.2:5000/api/v1`
  * iOS Simulator / Desktop: `http://localhost:5000/api/v1`
  * Real Device (WiFi Local IP): `http://<YOUR_LOCAL_IP>:5000/api/v1`
* **Base URL (Production / Staging):** `https://insurflow-backend.onrender.com/api/v1`
* **Headers العامة لجميع الطلبات المحمية:**
  ```http
  Authorization: Bearer <FIELD_ADJUSTER_ACCESS_TOKEN>
  ```
* **تتبع الموقع الجغرافي التلقائي (Passive GPS Ingestion):**
  يمكن للموبايل إرسال إحداثيات المساح اللحظية مع **أي طلب HTTP** يقوم به تلقائياً عبر الهيدرز التالية:
  ```http
  X-Adjuster-Latitude: 31.9050
  X-Adjuster-Longitude: 35.2040
  ```
  يقوم الباك إند تلقائياً بتحديث موقع المساح في قاعدة البيانات لتسهيل توجيه أقرب المهام له.

---

## 1. المصادقة وإعداد الحساب (Authentication & Device Registration)

### 1.1 تسجيل دخول المساح الميداني (Login)
* **المسار (Endpoint):** `POST /api/v1/auth/login`
* **Headers:** `Content-Type: application/json`
* **Request Body:**
  ```json
  {
    "organizationCode": "DEMO-INS",
    "employeeCode": "ADJ-001",
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
        "id": "6aa280c2ff3ba88a24c4e5dc",
        "name": "Ahmad Adjuster",
        "employeeCode": "ADJ-001",
        "role": "FIELD_ADJUSTER",
        "organizationId": "6a919f45e62778a597174333",
        "organizationName": "Demo Insurance Co"
      }
    }
  }
  ```

---

### 1.2 تسجيل رمز إشعارات Firebase (Register / Update Device FCM Token)
* **المسار (Endpoint):** `PATCH /api/v1/users/me/fcm-token`
* **Headers:**
  ```http
  Authorization: Bearer <TOKEN>
  Content-Type: application/json
  ```
* **Request Body:**
  ```json
  {
    "fcmToken": "eXamPLe_fCm_dEvIcE_tOkEn_sTrInG..."
  }
  ```
* **الوصف:** استدعِ هذا الـ Endpoint فور تسجيل الدخول وعند تجدد الـ FCM Token من Firebase لاستقبال إشعارات المهام الجديدة وتحديثات المطالبات.

---

### 1.3 تغيير كلمة المرور (Change Password)
* **المسار (Endpoint):** `PUT /api/v1/auth/change-password`
* **Request Body:**
  ```json
  {
    "currentPassword": "Password123!",
    "newPassword": "NewStrongAdjusterPassword2026!"
  }
  ```

---

## 2. مركز الإشعارات وتنبيهات المهام (In-App Notification Center & Push Notifications)

> 💡 **توضيح لمطور الموبايل (الفرق بين FCM و In-App Notifications):**
> * **إشعارات الـ FCM (`PATCH /users/me/fcm-token`):** تُستخدم لبث إشعار منبثق (System Push Notification) يظهر على شاشة قفل الهاتف عندما يكون التطبيق في الخلفية أو مغلقاً.
> * **مركز الإشعارات داخل التطبيق (In-App Notifications):** هي الـ APIs الثلاثة التالية لعرض شاشة قائمة الإشعارات السابقة للمساح، وعداد الإشعارات غير المقروءة على أيقونة الجرس 🔔، وتعليم الإشعار كمقروء عند الضغط عليه.

### 2.1 جلب قائمة الإشعارات (Get Notifications List)
* **المسار (Endpoint):** `GET /api/v1/notifications`
* **Headers:** `Authorization: Bearer <FIELD_ADJUSTER_TOKEN>`
* **Query Parameters:**
  * `page`: رقم الصفحة (افتراضي 1)
  * `limit`: عدد النتائج في الصفحة (افتراضي 20، الحد الأقصى 100)
  * `unreadOnly`: اختياري، `true` لجلب الإشعارات غير المقروءة فقط، أو `false` لجلب الكل.
* **Pagination Headers في الرد:**
  * `X-Total-Count`: إجمالي عدد الإشعارات
  * `X-Page`: الصفحة الحالية
  * `X-Limit`: عدد العناصر لكل صفحة
  * `X-Total-Pages`: إجمالي عدد الصفحات
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Notifications retrieved successfully",
    "data": [
      {
        "_id": "6aa345b5ac5bad231173c255",
        "recipientId": "6aa280c2ff3ba88a24c4e5dc",
        "organizationId": "6a919f45e62778a597174333",
        "type": "ASSIGNED",
        "relatedClaimId": {
          "_id": "6aa290c2ff3ba88a24c4e999",
          "claimNumber": "CLM-DEMO-0001"
        },
        "title": "New Inspection Assignment",
        "body": "You have been assigned to inspect claim CLM-DEMO-0001.",
        "readAt": null,
        "createdAt": "2026-09-25T11:30:00.000Z"
      }
    ]
  }
  ```

---

### 2.2 جلب عدد الإشعارات غير المقروءة (Get Unread Count for Badge)
* **المسار (Endpoint):** `GET /api/v1/notifications/unread-count`
* **Headers:** `Authorization: Bearer <FIELD_ADJUSTER_TOKEN>`
* **الوصف:** استدعِ هذا الـ Endpoint لعرض الرقم الدائري الأحمر (Badge) فوق أيقونة الجرس 🔔 في التطبيق.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Unread count retrieved successfully",
    "data": {
      "count": 3
    }
  }
  ```

---

### 2.3 تحديد الإشعار كمقروء (Mark Notification as Read)
* **المسار (Endpoint):** `PATCH /api/v1/notifications/:id/read`
* **Headers:** `Authorization: Bearer <FIELD_ADJUSTER_TOKEN>`
* **الوصف:** عند نقر المستخدم على الإشعار من القائمة، استدعِ هذا الـ Endpoint لتعليمه كمقروء وتحديث العداد. (العملية Idempotent).
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Notification marked as read",
    "data": {
      "id": "6aa345b5ac5bad231173c255",
      "readAt": "2026-09-25T12:00:00.000Z"
    }
  }
  ```

---

### 2.4 كود Flutter (Dio) لمركز الإشعارات:
```dart
// 1. جلب عداد غير المقروء للـ Badge
Future<int> fetchUnreadNotificationsCount(String baseUrl, String token) async {
  final dio = Dio();
  final res = await dio.get(
    '$baseUrl/notifications/unread-count',
    options: Options(headers: {'Authorization': 'Bearer $token'}),
  );
  return res.data['data']['count'] as int;
}

// 2. جلب قائمة الإشعارات
Future<List<dynamic>> fetchNotifications(String baseUrl, String token, {int page = 1}) async {
  final dio = Dio();
  final res = await dio.get(
    '$baseUrl/notifications?page=$page&limit=20',
    options: Options(headers: {'Authorization': 'Bearer $token'}),
  );
  return res.data['data'] as List<dynamic>;
}

// 3. تعليم إشعار كمقروء عند النقر
Future<void> markNotificationAsRead(String baseUrl, String token, String notificationId) async {
  final dio = Dio();
  await dio.patch(
    '$baseUrl/notifications/$notificationId/read',
    options: Options(headers: {'Authorization': 'Bearer $token'}),
  );
}
```

---

## 3. إدارة المطالبات والمهام الميدانية (Claims Queue & Actions)

### 2.1 جلب المطالبات المعينة للمساح (List Assigned Claims)
* **المسار (Endpoint):** `GET /api/v1/claims`
* **Query Parameters (فلترة التبويبات):**
  * `status`: `PENDING_ACCEPTANCE` | `ASSIGNED` | `IN_PROGRESS` | `SUBMITTED`
  * `page`: رقم الصفحة (افتراضي 1)
  * `limit`: عدد النتائج (افتراضي 10)
* **مثال الرابط:** `GET /api/v1/claims?status=IN_PROGRESS`

---

### 2.2 قبول مهمة التعيين (Accept Assignment)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/accept-assignment`
* **الوصف:** ينقل حالة المطالبة من `PENDING_ACCEPTANCE` إلى `ASSIGNED`.
* **Request Body:** `{}` (جسم فارغ).

---

### 2.3 رفض مهمة التعيين (Decline Assignment)
* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/decline-assignment`
* **Request Body:**
  ```json
  {
    "reason": "Vehicle is located outside assigned coverage zone"
  }
  ```

---

### 2.4 بدء المعاينة الميدانية (Start / Resume Inspection)
> ⚠️ **مهم جداً:** هذا الطلب إلزامي لنقل المطالبة من `ASSIGNED` إلى **`IN_PROGRESS`**. لن يقبل الباك إند رفع الصور أو التوقيع إلا إذا كانت المطالبة في حالة `IN_PROGRESS`.

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/inspection/start`
* **Request Body:** `{}` (جسم فارغ).
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Inspection started successfully",
    "data": {
      "status": "IN_PROGRESS"
    }
  }
  ```

---

## 3. التوثيق التفصيلي لرفع الصور والتوقيع الرقمي (Evidence Photos & Signature)

### 3.1 رفع صور المعاينة (Upload Evidence Photos)

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/evidence`
* **طريقة الإرسال (Method):** `POST`
* **نوع المحتوى (Content-Type):** `multipart/form-data`
* **الهيدرز المطلوبة (Headers):**
  ```http
  Authorization: Bearer <TOKEN>
  Content-Type: multipart/form-data
  ```

#### الـ Body (`FormData`):
| اسم الحقل (Key) | النوع (Type) | إجباري؟ | الوصف والقيم المسموحة |
| :--- | :--- | :--- | :--- |
| **`file`** | File (Binary) | **نعم (Required)** | ملف الصورة من الكاميرا أو المعرض.<br>• الصيغ المدعومة: `image/jpeg` (`.jpg`, `.jpeg`), `image/png` (`.png`), `image/webp` (`.webp`).<br>• الحجم الأقصى: **10MB**. |
| **`imageType`** | Text (String) | **نعم (Required)** | تصنيف الصورة، ويجب أن يكون **واحداً حصراً من قيم الـ Enum التالية**: |

#### قيم `imageType` المعتمدة:
1. `VEHICLE_FRONT` — مقدمة المركبة
2. `VEHICLE_REAR` — خلفية المركبة
3. `VEHICLE_SIDE` — جانب المركبة (الأيمن أو الأيسر)
4. `DAMAGE_CLOSEUP` — صورة مقربة لمكان الكسر / الضرر
5. `DRIVER_LICENSE` — رخصة القيادة / أوراق السائق
6. `OTHER` — أي مستند أو زاوية أخرى

#### سلوك الحفظ (Additive):
كل استدعاء لهذا الـ Endpoint يرفع صورة واحدة ويقوم بإضافتها تلقائياً إلى مصفوفة صور المعاينة `claim.evidence`، مع تسجيل هوية المساح وتاريخ ووقت الرفع في الـ Timeline.

#### الرد الناجح (200 OK):
```json
{
  "success": true,
  "message": "Evidence uploaded successfully",
  "data": {
    "status": "IN_PROGRESS",
    "evidence": [
      {
        "imageType": "VEHICLE_FRONT",
        "url": "https://res.cloudinary.com/insurflow/.../image.jpg",
        "publicId": "insurflow/org-1/evidence/evidence_12345",
        "uploadedBy": "6aa280c2ff3ba88a24c4e5dc",
        "uploadedAt": "2026-09-25T11:40:00.000Z"
      }
    ]
  }
}
```

---

### 3.2 رفع التوقيع الرقمي (Upload Digital Signature)

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/signature`
* **طريقة الإرسال (Method):** `POST`
* **نوع المحتوى (Content-Type):** `multipart/form-data`
* **الهيدرز المطلوبة (Headers):**
  ```http
  Authorization: Bearer <TOKEN>
  Content-Type: multipart/form-data
  ```

#### الـ Body (`FormData`):
| اسم الحقل (Key) | النوع (Type) | إجباري؟ | الوصف والقيم المسموحة |
| :--- | :--- | :--- | :--- |
| **`file`** | File (Binary) | **نعم (Required)** | ملف صورة التوقيع الرقمي المُصدرة من شاشة الرسم (Signature Pad) بالهاتف.<br>• الصيغ المدعومة: `image/png` أو `image/jpeg` أو `image/webp`.<br>• الحجم الأقصى: **10MB**.<br>*(لا يحتاج أي حقل نصي إضافي في البودي)*. |

#### سلوك الحفظ (Overwritable):
تعتمد المعاينة على **توقيع رسمي واحد معتمد**. في حال قام العميل أو المساح بإعادة رسم التوقيع، فإن أي استدعاء لاحق لنفس المسار يقوم باستبدال التوقيع السابق فوراً (`$set`) في كائن `claim.signature` دون ترك سجلات مكررة أو تالفة.

#### الرد الناجح (200 OK):
```json
{
  "success": true,
  "message": "Signature captured successfully",
  "data": {
    "status": "IN_PROGRESS",
    "signature": {
      "url": "https://res.cloudinary.com/insurflow/.../signature.png",
      "publicId": "insurflow/org-1/signatures/signature_12345",
      "capturedBy": "6aa280c2ff3ba88a24c4e5dc",
      "capturedAt": "2026-09-25T11:42:00.000Z"
    }
  }
}
```

---

## 4. أمثلة كود فلاتر كاملة (Flutter Implementation with Dio)

### 4.1 دالة رفع صورة المعاينة (Upload Evidence Photo)
```dart
import 'package:dio/dio.dart';

Future<bool> uploadInspectionEvidence({
  required String baseUrl,
  required String token,
  required String claimId,
  required String filePath,
  required String imageType, // e.g. 'DAMAGE_CLOSEUP', 'VEHICLE_FRONT'
}) async {
  final dio = Dio();

  try {
    final formData = FormData.fromMap({
      'imageType': imageType,
      'file': await MultipartFile.fromFile(
        filePath,
        filename: filePath.split('/').last,
      ),
    });

    final response = await dio.post(
      '$baseUrl/claims/$claimId/evidence',
      data: formData,
      options: Options(
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'multipart/form-data',
        },
      ),
    );

    if (response.statusCode == 200 && response.data['success'] == true) {
      print('Evidence uploaded: ${response.data['data']['evidence']}');
      return true;
    }
    return false;
  } on DioException catch (e) {
    print('Upload Evidence Error: ${e.response?.data ?? e.message}');
    return false;
  }
}
```

---

### 4.2 دالة رفع التوقيع الرقمي من الذاكرة (Upload Signature from Memory Bytes)
```dart
import 'dart:typed_data';
import 'package:dio/dio.dart';

Future<bool> uploadDigitalSignature({
  required String baseUrl,
  required String token,
  required String claimId,
  required Uint8List signatureBytes, // من الـ SignatureController / SignaturePad
}) async {
  final dio = Dio();

  try {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        signatureBytes,
        filename: 'customer_signature.png',
      ),
    });

    final response = await dio.post(
      '$baseUrl/claims/$claimId/signature',
      data: formData,
      options: Options(
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'multipart/form-data',
        },
      ),
    );

    if (response.statusCode == 200 && response.data['success'] == true) {
      print('Signature saved: ${response.data['data']['signature']['url']}');
      return true;
    }
    return false;
  } on DioException catch (e) {
    print('Upload Signature Error: ${e.response?.data ?? e.message}');
    return false;
  }
}
```

---

## 5. حفظ مسودات المعاينة الميدانية (Draft Inspection Data)

قبل تسليم المعاينة النهائي، يقوم المساح بتعبئة تفاصيل المسودة وحفظها مرحلياً عبر المسارات التالية:

### 5.1 حفظ بيانات المركبة (`PUT /api/v1/claims/:claimId/vehicle`)
```json
{
  "plateNumber": "ABC-1234",
  "vin": "1HGCR2F83HA000000",
  "make": "Toyota",
  "model": "Camry",
  "year": 2024,
  "color": "White",
  "policyNumber": "POL-2026-001"
}
```

### 5.2 حفظ بيانات الحادث والأضرار (`PUT /api/v1/claims/:claimId/accident`)
```json
{
  "accidentType": "COLLISION",
  "damageSeverity": "MODERATE",
  "damagedParts": ["Front Bumper", "Left Headlight", "Hood"],
  "initialEstimate": 3500.00,
  "driverStatement": "Another car merged into my lane at low speed.",
  "thirdPartyInvolved": false
}
```

### 5.3 حفظ موقع المعاينة الميدانية (`PUT /api/v1/claims/:claimId/location`)
```json
{
  "latitude": 31.9050,
  "longitude": 35.2040,
  "address": "King Fahd Road, Riyadh"
}
```

---

## 6. تسليم تقرير المعاينة النهائي (Submit Inspection Report)

* **المسار (Endpoint):** `POST /api/v1/claims/:claimId/inspection/submit`
* **Request Body:** `{}` (فارغ).
* **الوصف:** يقوم بنقل المطالبة من حالة `IN_PROGRESS` إلى **`SUBMITTED`**.

### 🏛️ قاعدة الأركان الخمسة الإلزامية لاكتمال المعاينة (5-Pillar Rule):
يقوم الباك إند بإجراء فحص أمني دقيق للتأكد من وجود البيانات الخمسة التالية، وفي حال نقص أي منها يُرفض الطلب فوراً برمز **`422 INSPECTION_INCOMPLETE`**:
1. **بيانات المركبة (`claim.vehicle.plateNumber`)**: غير فارغة.
2. **بيانات الحادث (`claim.accident.accidentType`)**: غير فارغة.
3. **موقع المعاينة (`claim.location.latitude`)**: مسجل.
4. **الصور التوثيقية (`claim.evidence`)**: تحتوي على **صورة واحدة على الأقل**.
5. **التوقيع الرقمي (`claim.signature.url`)**: التوقيع مرفوع وموثق.

---

## 7. جدول رموز الاستجابة والتعامل مع الأخطاء (HTTP Error Codes)

| كود الحالة (Status) | رمز الخطأ (Error Code) | السبب والحل في الموبايل |
| :--- | :--- | :--- |
| **`200 OK`** | - | تم تنفيذ العملية بنجاح. |
| **`400 Bad Request`** | `VALIDATION_ERROR` | • نقص حقل إلزامي مثل `file` أو `imageType`.<br>• قيمة `imageType` غير مطابقة للـ Enum.<br>• حجم الملف أكبر من 10MB.<br>• صيغة الملف غير مدعومة (ليست jpeg/png/webp). |
| **`401 Unauthorized`** | `UNAUTHORIZED` | التوكن غير موجود أو منتهي الصلاحية. يجب تحويل المستخدم لصفحة تسجيل الدخول. |
| **`403 Forbidden`** | `FORBIDDEN` | المستخدم الحالي ليس `FIELD_ADJUSTER`. |
| **`404 Not Found`** | `CLAIM_NOT_FOUND` | المطالبة غير موجودة، أو تتبع شركة أخرى، أو **معينة لمساح آخر غير المسجل حالياً**. |
| **`409 Conflict`** | `INVALID_STATUS_TRANSITION` | المطالبة ليست في حالة `IN_PROGRESS`. تأكد من استدعاء `inspection/start` أولاً قبل رفع الصور والتوقيع. |
| **`422 Unprocessable`** | `INSPECTION_INCOMPLETE` | عند محاولة عمل `submit` وهناك ركن ناقص من الأركان الخمسة (مثل نسيان التوقيع أو عدم التقاط صور). |
