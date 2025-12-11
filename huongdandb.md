# Hướng dẫn Database cho Wi-Fi Marketing Platform

> **Lưu ý:** Tất cả hướng dẫn DB, schema, migration, seed, câu lệnh SQL, trigger, query và gợi ý triển khai **AI Cursor sẽ tự động insert vào file này**.

---

## 1. Database Overview
- Tên Database: `wifi_marketing_platform`
- Loại DB: PostgreSQL / MySQL (tuỳ triển khai)
- Tables chính:
  - `users` (anonymous users, first/repeat visit)
  - `sessions` (session tracking, AP, device info)
  - `campaigns` (campaign info, targeting, scheduling)
  - `impressions` (ad view logs)
  - `clicks` (ad click logs)
  - `surveys` (first-time survey responses)
  - `brands` (multi-brand support)
  - `locations` (AP/location info)
  - `audit_logs` (role-based changes, admin actions)

---

## 2. Schema & Tables
> **AI Cursor sẽ auto generate đầy đủ CREATE TABLE / ALTER TABLE / constraints / indexes ở đây.**

---

## 3. Migrations & Seed
> **AI Cursor sẽ tạo migration scripts & seed data trực tiếp vào đây.**

---

## 4. Queries & Reports
> **AI Cursor sẽ viết sẵn các query chuẩn, KPI report, session analytics, impressions/clicks tổng hợp, heatmap queries.**

---

## 5. Triggers & Stored Procedures
> **AI Cursor sẽ tự động sinh triggers, stored procedures, ví dụ:**
> - Update campaign impression count.
> - Flag first-time survey completion.
> - Clean expired sessions.

---

## 6. Connection & Environment
- Connection string, environment variables, user/password, port.
- AI Cursor sẽ insert hướng dẫn config DB container, persistent volumes.

---

## 7. Notes
- **Tất cả logic DB do AI Cursor quản lý tự động. Không chỉnh trực tiếp.**
- Cập nhật schema, seed, query → AI Cursor auto insert tại file này.

