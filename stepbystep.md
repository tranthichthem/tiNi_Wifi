# AI Cursor Step-by-Step Project Creation Prompt

## Step 1: Đọc yêu cầu
1. Mở và đọc toàn bộ nội dung của `yeucau.md`.
2. Xác định tất cả modules, tính năng, database, deployment, multi-brand, multi-location, role-based access.

## Step 2: Tạo folder structure
1. Tạo các thư mục sau:
   - /captive-portal
   - /campaign-api
   - /tracking-service
   - /dashboard
   - /admin-portal
   - /database
2. Trong /database, tạo file `huongdandb.md`.

## Step 3: Tạo Docker setup
1. Tạo Dockerfile cho từng module.
2. Tạo docker-compose.yml:
   - Kết nối các service: captive-portal, campaign-api, tracking-service, dashboard, admin-portal, database, cache.
   - Network: tini_net
   - Persistent volumes cho DB/cache
3. Thiết lập environment variables, HTTPS, API keys.

## Step 4: Tạo code skeleton cho từng module
1. Captive Portal: UI, multi-language, survey first-time visit.
2. Campaign API: CRUD, targeting, scheduling, A/B testing.
3. Tracking Service: log impressions, clicks, sessions, first/repeat visits.
4. Dashboard/Admin Portal: KPI, heatmaps, reports.

## Step 5: Database setup (quan trọng)
1. Trong `/database/huongdandb.md`:
   - Auto sinh schema, migration, seed, queries, triggers.
   - Tables chính: users, sessions, campaigns, impressions, clicks, surveys, brands, locations, audit_logs.
   - Seed dữ liệu demo: brands, locations.
   - Queries cho analytics, session tracking.
2. **Không tạo DB logic ở bất cứ file nào khác**, tất cả chỉ trong `huongdandb.md`.

## Step 6: README / Deployment
1. Tạo README ngắn gọn hướng dẫn deploy bằng docker-compose.
2. Hướng dẫn chạy từng module, migrate DB, seed dữ liệu.

## Step 7: Output
- Tạo toàn bộ folder structure, Dockerfile, docker-compose.yml, code skeleton.
- `huongdandb.md` đầy đủ database logic.
- README hướng dẫn deploy.
- Mỗi bước tạo xong, báo trạng thái thành công trước khi tiếp bước tiếp theo.
