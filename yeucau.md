# Wi-Fi Marketing Platform - Professional Project Design

## 1. Overview
Mục tiêu: Triển khai hệ thống Free Wi-Fi Marketing chuyên nghiệp, tương tự AWING, bao gồm:
- End Users kết nối Free Wi-Fi.
- Captive Portal hiển thị quảng cáo + survey để được truy cập Wi-Fi.
- Tracking session, click, view của người dùng.
- Admin/Advertiser Portal: quản lý campaign, phân tích KPI, báo cáo.
- API: Campaign, Tracking, User/Session.
- Hệ thống dockerized, multi-brand, multi-location, role-based.

---

## 2. Professional Architecture Diagram (ASCII)
          ┌─────────────┐
          │  End Users  │
          └─────┬───────┘
                │
                ▼
       ┌─────────────────┐
       │ Meraki AP/Cloud │
       │(Redirect captive│
       │portal + RADIUS)│
       └─────┬──────────┘
             │
             ▼
       ┌───────────────┐
       │ RADIUS Server │
       │(Auth & Accounting│
       │ bridge to API) │
       └─────┬─────────┘
             │
             ▼
 ┌─────────────────────────┐
 │ Wi-Fi Marketing Platform│
 │ ┌─────────────────────┐ │
 │ │  Captive Portal     │ │
 │ │   (UI + Ads + Survey)│ │
 │ │   Multi-language    │ │
 │ │   Personalized Ads  │ │
 │ └────────┬────────────┘ │
 │          │              │
 │ ┌────────▼────────┐     │
 │ │  Campaign API    │     │
 │ │ Advanced Targeting│    │
 │ │ Scheduling & A/B │     │
 │ │ Testing          │     │
 │ └────────┬────────┘     │
 │          │               │
 │ ┌────────▼────────┐     │
 │ │ Tracking Service │     │
 │ │ (View/Click/Session│   │
 │ │   First/Repeat    │   │
 │ │   Visit Survey)   │   │
 │ └────────┬────────┘     │
 │          │               │
 │ ┌────────▼────────┐     │
 │ │     Database     │     │
 │ │ (All DB instructions │ │
 │ │  auto-inserted by   │ │
 │ │  AI Cursor into     │ │
 │ │  huongdandb.md)     │ │
 │ └────────┬────────┘     │
 │          │               │
 │ ┌────────▼────────┐     │
 │ │ Cache / Session  │     │
 │ │ Anonymous ID map │     │
 │ └────────┬────────┘     │
 │          │               │
 │ ┌────────▼────────┐     │
 │ │ Dashboard /     │     │
 │ │ Analytics       │     │
 │ │ Realtime KPI,   │     │
 │ │ Heatmap, Trend  │     │
 │ └────────┬────────┘     │
 └─────────────┬───────────┘
               │
               ▼
       ┌───────────────┐
       │ Advertisers / │
       │    Brands     │
       └───────────────┘
       ┌─────────────────────────────┐
       │ Admin / Advertiser Portal   │
       │ ┌──────────────┐           │
       │ │ Campaign     │           │
       │ │ Management   │           │
       │ │ Scheduling,  │           │
       │ │ Targeting,   │           │
       │ │ A/B Testing  │           │
       │ └──────┬───────┘           │
       │        │                   │
       │ ┌──────▼───────┐           │
       │ │ Location/AP  │           │
       │ │ Management   │           │
       │ │ Geo-fencing, │           │
       │ │ Cluster,     │           │
       │ │ Status       │           │
       │ └──────┬───────┘           │
       │        │                   │
       │ ┌──────▼───────┐           │
       │ │ User/Session │           │
       │ │ Analytics    │           │
       │ │ Segmentation │           │
       │ │ Survey Data  │           │
       │ └──────┬───────┘           │
       │        │                   │
       │ ┌──────▼───────┐           │
       │ │ Reports/KPI  │           │
       │ │ Export PDF/CSV │          │
       │ │ Alerts       │           │
       │ └──────┬───────┘           │
       │        │                   │
       │ ┌──────▼───────┐           │
       │ │ Brand/Account│           │
       │ │ Management   │           │
       │ │ Multi-brand, │           │
       │ │ Role-based   │           │
       │ │ Audit Logs   │           │
       │ └──────────────┘           │
       └─────────┬─────────────        │
       └─────────┬─────────────────┘
                 │
                 ▼
       ┌─────────────────────────┐
       │ Wi-Fi Marketing Platform │
       │ (Captive Portal +       │
       │ Tracking + Database +  │
       │ Analytics)              │
       └─────────────────────────┘
      2.1 Captive Portal
            Hiển thị UI responsive, đa ngôn ngữ.
            Hiển thị quảng cáo cá nhân hóa dựa theo AP/location, device type, thời gian, lượt truy cập.
            REST API endpoint: /api/captive/start-session
            Input: ap_id, mac_address, device_type
            Output: session_id, ads_list, survey_required
            REST API endpoint: /api/captive/submit-survey
            Input: session_id, survey answers
            Output: success/fail
      
      2.2 Campaign API
            CRUD campaign, targeting, scheduling, A/B testing.
            REST API endpoints:
                  POST /api/campaign – tạo campaign mới
                  GET /api/campaign/:id – lấy chi tiết campaign
                  PUT /api/campaign/:id – cập nhật
                  DELETE /api/campaign/:id – xóa
                  GET /api/campaign – list campaign theo brand/location/status
            Advanced targeting: first/repeat visit, device type, AP/location, datetime, user segment.

      2.3 Tracking Service
            Track session, impression, click, survey submission.
            REST API endpoints:
                  POST /api/tracking/session-start – session bắt đầu
                  POST /api/tracking/session-end – session kết thúc
                  POST /api/tracking/impression – log view ads
                  POST /api/tracking/click – log click ads

      2.4 Database
            Database logic hoàn toàn tự sinh bởi AI Cursor vào file huongdandb.md
            Các bảng chính:
                  users (anonymous user id, device info, first_visit_date)
                  sessions (session_id, user_id, ap_id, start_time, end_time)
                  campaign (id, brand_id, targeting, schedule, A/B variants)
                  ads (id, campaign_id, content, type, media_url)
                  impressions (session_id, ad_id, timestamp)
                  clicks (session_id, ad_id, timestamp)
                  surveys (session_id, answers JSON)
                  locations (ap_id, name, brand_id, geo)
                  brands (id, name, admin_id)
                  admins (id, name, role, brand_id, credentials)

      2.5 Cache / Session
            Lưu session_id → user_id mapping
            Lưu temporary data cho campaign selection

      2.6 Dashboard / Analytics
            Realtime KPI: sessions, impressions, clicks, surveys
            Heatmap theo location, AP
            Export PDF/CSV
            REST API: /api/analytics/kpi, /api/analytics/heatmap, /api/analytics/report

      2.7 Admin / Advertiser Portal
            Campaign, Location, User/Session management
            Multi-brand, role-based
            KPI reports, alerts
            REST API endpoints cho CRUD, export, alerts
---

## 3. Professional Modules
1. **Captive Portal**: Responsive, multi-language, personalized ads, survey first-time visit, anonymous tracking. REST API: /api/captive/start-session, /api/captive/submit-survey.
2. **Campaign API**: CRUD campaign, targeting, scheduling, A/B testing, approval workflow. REST API endpoints: /api/campaign, /api/campaign/:id, /api/campaign.
3. **Tracking Service**: Track impressions, clicks, sessions, first/repeat visits. REST API endpoints: /api/tracking/session-start, /api/tracking/impression, /api/tracking/click.
4. **Database**: **All database logic, schema, migrations, seed, queries, and instructions are handled automatically by AI Cursor in `huongdandb.md`**.
5. **Cache / Session**: Temporary session & anonymous ID storage.
6. **Dashboard / Analytics**: Real-time KPI, segmentation, heatmaps, downloadable reports. REST API: /api/analytics/kpi, /api/analytics/heatmap, /api/analytics/report.
7. **Admin / Advertiser Portal**: Campaign/Location/User management, KPI reports, multi-brand & role-based access. REST API CRUD + export + alerts.

---

## 4. Docker Deployment Concept
- Separate containers: captive-portal, campaign-api, tracking-service, database, cache, dashboard, admin-portal.
- Internal network `tini_net`.
- Persistent volumes for DB/cache.
- Reverse proxy/nginx for external access.
- Environment variables: API keys, Meraki URLs, secrets.

---

## 5. Data Flow Summary
1. End User → Meraki AP → Captive Portal /api/captive/start-session.
2. RADIUS Auth → Wi-Fi Marketing API.
3. Captive portal shows ads + survey (first-time).
4. Tracking Service logs session/impressions/clicks.
5. **Database handled via `huongdandb.md` by AI Cursor**.
6. Dashboard/Admin read data → KPI, heatmaps, reports.
7. Advertisers manage campaign, view KPI.

---

## 6. Professional Notes
- Survey: **first-time visit only**.
- Campaign display: AP/location, device type, time/date, repeat/first-time visitor.
- Anonymous tracking, no login.
- Multi-location, multi-brand, role-based access.
- Optional monetization per impression/click/subscription.
- GDPR/local privacy compliance.
- High availability & monitoring.

---

## 7. AI Cursor Instructions
1. Tạo `docker-compose.yml`.
2. Dockerfile riêng cho mỗi module.
3. Internal network `tini_net`.
4. Persistent volumes cho DB/cache.
5. HTTPS cho captive portal & dashboards.
6. REST endpoints cho Campaign API & Tracking Service.
7. Survey, campaign targeting, analytics → AI Cursor tự triển khai.
8. **Database: All instructions, schema, migration, seed, queries → AI Cursor tự sinh và auto-insert vào `huongdandb.md`. File này là nơi duy nhất chứa DB logic.**

---

## 8. Optional / Advanced Features
- Multi-brand, multi-location.
- Role-based access: Admin, Brand Manager, Analyst.
- Alerts khi KPI thấp/container lỗi.
- Heatmap visualization.
- Export report CSV/PDF.
