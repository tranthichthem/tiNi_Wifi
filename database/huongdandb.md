# Hướng dẫn Database (PostgreSQL) – Wi‑Fi Marketing Platform

Lưu ý: Tất cả logic DB (schema, migration, seed, queries, triggers) tập trung tại file này.

## 1) Schema (DDL)

```sql
-- Extensions (UUID generation)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

```sql
-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin Users (for Admin/Advertiser Portal; not Wi‑Fi end users)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','brand_manager','analyst')),
  brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  api_token TEXT UNIQUE, -- simple token-based auth for demo
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Locations
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  ap_identifier TEXT, -- AP name/MAC/Serial
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users (anonymous)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id TEXT NOT NULL UNIQUE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  device_type TEXT,
  user_agent TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|pending_approval|active|paused|archived|rejected
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  targeting JSONB DEFAULT '{}',
  ab_test_variants JSONB DEFAULT '[]', -- Array of {name, weight, content}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impressions
CREATE TABLE IF NOT EXISTS impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clicks
CREATE TABLE IF NOT EXISTS clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Surveys (first-time)
CREATE TABLE IF NOT EXISTS surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  answers JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_impr_campaign ON impressions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_click_campaign ON clicks(campaign_id);
```

## 2) Seed dữ liệu demo

```sql
INSERT INTO brands (id, name)
VALUES
  (gen_random_uuid(), 'tiNi World')
ON CONFLICT DO NOTHING;

-- Seed one admin user (demo token: 'changeme-token')
INSERT INTO admin_users (email, role, api_token)
VALUES ('admin@tini.local', 'admin', 'changeme-token')
ON CONFLICT DO NOTHING;

INSERT INTO locations (id, brand_id, name, address, ap_identifier)
SELECT gen_random_uuid(), b.id, 'Store District 1', 'Ho Chi Minh City', 'AP-D1'
FROM brands b WHERE b.name = 'tiNi World'
ON CONFLICT DO NOTHING;

-- Optional: update demo location with coordinates (District 1 HCMC approximate)
UPDATE locations
SET latitude = 10.775658, longitude = 106.700424
WHERE name = 'Store District 1'
  AND latitude IS NULL AND longitude IS NULL;

INSERT INTO campaigns (id, brand_id, name, status)
SELECT gen_random_uuid(), b.id, 'Welcome Campaign', 'active'
FROM brands b WHERE b.name = 'tiNi World'
ON CONFLICT DO NOTHING;
```

## 2.5) Migration: Add A/B Testing và Approval Workflow

```sql
-- Add ab_test_variants column nếu chưa có
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test_variants JSONB DEFAULT '[]';

-- Update status constraint để hỗ trợ pending_approval và rejected
-- (PostgreSQL không hỗ trợ ALTER CHECK constraint trực tiếp, cần drop và recreate)
-- Nếu cần, có thể tạo migration script riêng hoặc chạy manual
```

## 3) Triggers/Functions tham khảo

```sql
-- Ensure last_seen updates on new session
CREATE OR REPLACE FUNCTION touch_user_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users SET last_seen = now() WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sessions_touch_user ON sessions;
CREATE TRIGGER trg_sessions_touch_user
AFTER INSERT ON sessions
FOR EACH ROW EXECUTE FUNCTION touch_user_last_seen();
```

## 4) Queries Analytics mẫu

```sql
-- KPI: impressions, clicks theo ngày
SELECT date_trunc('day', shown_at) AS day,
       COUNT(*) AS impressions
FROM impressions
GROUP BY 1 ORDER BY 1;

SELECT date_trunc('day', clicked_at) AS day,
       COUNT(*) AS clicks
FROM clicks
GROUP BY 1 ORDER BY 1;

-- First vs repeat sessions (approx)
WITH first_session AS (
  SELECT user_id, MIN(started_at) AS first_at FROM sessions GROUP BY 1
)
SELECT
  CASE WHEN s.started_at <= fs.first_at + interval '5 minutes' THEN 'first' ELSE 'repeat' END AS kind,
  COUNT(*)
FROM sessions s
JOIN first_session fs ON fs.user_id = s.user_id
GROUP BY 1;
```

## 5) Kết nối & Env

- Connection string: `postgres://postgres:postgres@database:5432/wifi_marketing_platform`
- Khởi tạo schema/seed: kết nối vào container Postgres và chạy các block SQL ở trên.

```bash
docker exec -it database psql -U postgres -d wifi_marketing_platform -c "SELECT now();"
```


