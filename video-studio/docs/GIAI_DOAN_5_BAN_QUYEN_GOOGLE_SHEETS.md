# HƯỚNG DẪN QUẢN LÝ BẢN QUYỀN (LICENSING) QUA GOOGLE SHEETS (0 ĐỒNG)
> **Dành cho Giai đoạn 5 — Đóng gói thương mại & Cấp quyền người dùng**  
> Quản lý thời hạn, khóa máy theo phần cứng (HWID) và thu hồi từ xa hoàn toàn miễn phí trên điện thoại.

---

## 1. MÔ HÌNH HOẠT ĐỘNG TỔNG QUAN

```
[Bác cầm điện thoại]                 [Google Trang Tính]               [Phần mềm trên máy khách]
 Thêm key / Sửa ngày hết hạn   ⇄   Google Apps Script API    ⇄     Video Studio (Electron/FastAPI)
 Đổi active ➔ blocked              (Web App URL bí mật)            Tự động kích hoạt / Khóa app
```

* **Chi phí**: 0 VNĐ vĩnh viễn (sử dụng hạ tầng Google Drive & Google Apps Script).
* **Chống share key**: Tự động ghim mã phần cứng (Hardware ID) của máy kích hoạt lần đầu.
* **Chống lùi đồng hồ máy tính**: So sánh thời gian hết hạn với giờ chuẩn máy chủ Google.
* **Điều khiển từ xa**: Bác chỉ cần mở app Google Sheets trên điện thoại là có thể khóa, gia hạn, thêm key trong tích tắc.

---

## 2. CẤU TRÚC FILE GOOGLE SHEETS CỦA BÁC

Bác tạo 1 file Google Sheets trên Google Drive (ví dụ đặt tên: `Video_Studio_Licenses`) với các cột tại Hàng 1 như sau:

| Cột A (`license_key`) | Cột B (`customer_name`) | Cột C (`machine_id`) | Cột D (`expires_at`) | Cột E (`status`) | Cột F (`notes`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `VS-KEY-001` | Nguyễn Văn A (0912xxx) | *(tự động ghim khi nhập)* | `2026-10-31` | `active` | Gói 1 tháng |
| `VS-KEY-002` | Trần Văn B | *(tự động ghim khi nhập)* | `2026-12-31` | `active` | Gói 3 tháng |
| `VS-KEY-003` | Lê Thị C | *(đã ghim HWID)* | `2026-09-30` | `blocked` | Vi phạm chính sách / Thu hồi |

---

## 3. MÃ NGUỒN GOOGLE APPS SCRIPT (DÁN VÀO GOOGLE SHEETS)

Trong Google Sheets, bác vào menu: **Tiện ích mở rộng ➔ Apps Script**, xóa hết code cũ và dán toàn bộ đoạn mã sau:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const key = (data.key || "").trim().toUpperCase();
    const machineId = (data.machine_id || "").trim();

    if (!key || !machineId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: "Mã key hoặc thông tin máy không hợp lệ!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const values = sheet.getDataRange().getValues();

    let foundRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim().toUpperCase() === key) {
        foundRow = i + 1; // 1-indexed
        break;
      }
    }

    if (foundRow === -1) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: "Mã bản quyền không tồn tại trong hệ thống!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const rowData = values[foundRow - 1];
    const customerName = rowData[1];
    let registeredHwid = String(rowData[2] || "").trim();
    const rawExpire = rowData[3];
    const status = String(rowData[4] || "active").trim().toLowerCase();

    // 1. Kiểm tra trạng thái kích hoạt từ Admin
    if (status === "blocked") {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: "Bản quyền này đã bị khóa bởi Admin. Vui lòng liên hệ hỗ trợ!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Chống share key: Tự động ghim máy lần đầu hoặc kiểm tra máy cũ
    if (!registeredHwid) {
      // Lần đầu kích hoạt -> Tự động điền mã máy của khách vào Google Sheet
      sheet.getRange(foundRow, 3).setValue(machineId);
      registeredHwid = machineId;
    } else if (registeredHwid !== machineId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: "Mã bản quyền này đã được kích hoạt trên một máy tính khác!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Kiểm tra ngày hết hạn so với giờ chuẩn của Google
    const now = new Date();
    const expireDate = new Date(rawExpire);
    // Cho phép dùng đến hết ngày ghi trên hạn (23:59:59)
    expireDate.setHours(23, 59, 59, 999);

    if (now.getTime() > expireDate.getTime()) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        is_expired: true,
        expires_at: rawExpire,
        message: "Bản quyền của bạn đã hết hạn vào ngày " + Utilities.formatDate(expireDate, "GMT+7", "dd/MM/yyyy") + ". Vui lòng gia hạn!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const daysLeft = Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      customer_name: customerName,
      expires_at: Utilities.formatDate(expireDate, "GMT+7", "yyyy-MM-dd"),
      days_left: daysLeft,
      message: "Kích hoạt bản quyền thành công! Hạn dùng còn " + daysLeft + " ngày."
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: "Lỗi xử lý hệ thống: " + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

### Cách lấy link Web App:
1. Trong màn hình Apps Script, bấm nút màu xanh **Triển khai (Deploy) ➔ Quản lý bản triển khai mới (New deployment)**.
2. Chọn loại: **Ứng dụng web (Web app)**.
3. Cấu hình:
   - **Thực thi dưới dạng (Execute as)**: Tôi (Me - tài khoản Google của bạn).
   - **Ai có quyền truy cập (Who has access)**: Bất kỳ ai (Anyone).
4. Bấm **Triển khai (Deploy)** ➔ Bác copy lấy đường link:  
   `https://script.google.com/macros/s/AKfycb.../exec`

---

## 4. BỘ MÃ KIỂM TRA TRÊN ỨNG DỤNG (CLIENT)

Khi bước vào Giai đoạn 5, phần mềm sẽ tích hợp 2 thành phần:

1. **Backend (`app/services/license_service.py`)**:
   - Tạo mã máy duy nhất (`Hardware ID`) từ thông tin mainboard/CPU.
   - Gửi yêu cầu kiểm tra lên link Google Apps Script.
   - Lưu cache mã hóa nội bộ (AES-256) để nếu người dùng mất mạng trong vài giờ khi đang làm việc thì app vẫn không bị giật/khóa đột ngột.
2. **Frontend (`LicenseModal.tsx`)**:
   - Nếu chưa nhập key hoặc key hết hạn: Khóa toàn bộ các nút thao tác, hiện màn hình kích hoạt bản quyền sang trọng kèm hotline/Zalo của bác.
   - Nếu key hợp lệ: Hiển thị thanh trạng thái nhỏ ở góc: *"Hạn dùng: 31/10/2026 (Còn 20 ngày)"*.

---

## 5. QUY TRÌNH BÁC VẬN HÀNH THỰC TẾ

1. **Bán gói mới**: Khách chuyển khoản ➔ Bác mở app Google Sheets trên điện thoại ➔ Thêm 1 dòng (Key: `VS-2026-X1`, Hạn: `15/10/2026`, Trạng thái: `active`). Gửi key cho khách là xong.
2. **Khách gia hạn**: Khách chuyển khoản thêm ➔ Bác sửa ngày `15/10/2026` thành `15/11/2026` trên Sheet ➔ Máy khách tự động nhận thêm 30 ngày.
3. **Khóa khẩn cấp**: Khách vi phạm hoặc đòi hoàn tiền ➔ Bác sửa chữ `active` thành `blocked` ➔ Máy khách bị khóa tức thì.
