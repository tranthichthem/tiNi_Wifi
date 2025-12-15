# tiNi Wi-Fi Marketing Platform

## Deploy nhanh bằng Docker Compose

1. Cài Docker & Docker Compose.
2. Chạy lệnh:

```bash
docker compose up -d --build
```

Services (qua reverse proxy HTTPS):
- captive-portal: https://localhost/
- dashboard: https://localhost/dashboard/
- admin-portal: https://localhost/admin/
- campaign-api: https://localhost/api/
- tracking-service: https://localhost/tracking/
- database (Postgres): localhost:5432
- cache (Redis): localhost:6379

### Chứng chỉ HTTPS
- Tạo self-signed cert dev vào `reverse-proxy/certs/`:

```bash
mkdir -p "/d/tiNi Corp/tiNi_wifi/reverse-proxy/certs"

cd "/d/tiNi Corp/tiNi_wifi/reverse-proxy/certs"

cat > tiNi-Wifi.cnf <<'EOF'
[ req ]
default_bits       = 2048
prompt             = no
default_md         = sha256
x509_extensions    = v3_req
distinguished_name = req_distinguished_name

[ req_distinguished_name ]
CN = tiNi-Wifi

[ v3_req ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1   = localhost
IP.1    = 127.0.0.1
EOF

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
-keyout tiNi-Wifi.key \
-out tiNi-Wifi.crt \
-config tiNi-Wifi.cnf -extensions v3_req

```

### Lần đầu khởi tạo DB
- DB sẽ tạo trống. Xem `database/huongdandb.md` để chạy schema/seed.

### Đăng nhập Admin (token demo)
- Hệ thống dùng token đơn giản qua header `X-Admin-Token` để demo RBAC.
- Token mặc định (demo): `changeme-token` (đã seed trong `admin_users`).
- Vào https://localhost/admin/ nhập token ở ô “Admin Token”, nhấn Save.
- Các thao tác tạo/sửa/xóa sẽ được bảo vệ và ghi vào `audit_logs`.

### Phát triển
- Sửa nội dung các module trong thư mục tương ứng.
- Rebuild service nếu thay đổi Dockerfile hoặc dependencies:

```bash
docker compose up -d --build <service_name>
```

## CI/CD với GitHub Actions

Dự án đã được cấu hình CI/CD tự động với GitHub Actions:

### Workflows có sẵn:
1. **CI - Build and Test**: 
   - Tự động chạy `docker compose up -d --build` khi có push/PR
   - Build và khởi động tất cả services trên GitHub Actions
   - Kiểm tra health của các services
   - Tự động cleanup sau khi test
2. **CD - Build and Push**: Tự động build và push Docker images lên GitHub Container Registry
3. **Deploy**: Workflow để deploy lên production (manual trigger)

### Cách sử dụng:
- **Tự động**: Push code lên `main`/`master` → CI tự động chạy `docker compose up -d --build` và test
- **Release**: Tạo tag `v1.0.0` → Tự động build và push images
- **Deploy**: Vào GitHub Actions → Chọn workflow Deploy → Run workflow

Xem chi tiết tại: [`.github/workflows/README.md`](.github/workflows/README.md)

### Docker Images:
Sau khi CD chạy, images có sẵn tại:
- `ghcr.io/<owner>/tini-wifi-reverse-proxy`
- `ghcr.io/<owner>/tini-wifi-captive-portal`
- `ghcr.io/<owner>/tini-wifi-dashboard`
- `ghcr.io/<owner>/tini-wifi-admin-portal`
- `ghcr.io/<owner>/tini-wifi-campaign-api`
- `ghcr.io/<owner>/tini-wifi-tracking-service`



