import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import { createClient as createRedisClient } from 'redis';
import PDFDocument from 'pdfkit';

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createRedisClient({ url: process.env.REDIS_URL || 'redis://cache:6379' });
redis.on('error', (err) => console.error('Redis Client Error', err));
await redis.connect();

// Helpers
const deg2rad = (deg) => (deg * Math.PI) / 180;
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function checkHttpHealth(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { label, status: 'down', detail: `HTTP ${res.status}` };
    }
    return { label, status: 'up' };
  } catch (e) {
    clearTimeout(timeout);
    return { label, status: 'down', detail: e.message };
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tracking-service' });
});

// RADIUS bridge (stub): auth
app.post('/api/radius/auth', async (req, res) => {
  // Accept all and bridge to session-start if provided
  const { mac_address, ap_id, device_type } = req.body || {};
  try {
    const startRes = await fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/tracking/session-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mac_address,
        locationId: ap_id ? null : null, // placeholder mapping
        deviceType: device_type,
        userAgent: 'RADIUS-bridge',
      }),
    });
    const startData = await startRes.json();
    res.json({ ok: true, radius: 'Access-Accept', sessionId: startData.sessionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// RADIUS accounting stub
app.post('/api/radius/accounting', async (req, res) => {
  const { session_id, status } = req.body || {};
  try {
    if (status === 'stop' && session_id) {
      await pool.query('UPDATE sessions SET ended_at = now() WHERE id = $1', [session_id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Captive Portal: start session (per yeucau.md)
app.post('/api/captive/start-session', async (req, res) => {
  const { ap_id, mac_address, device_type } = req.body || {};
  try {
    // Resolve location by AP identifier (if provided)
    let locationId = null;
    if (ap_id) {
      const locResult = await pool.query('SELECT id FROM locations WHERE ap_identifier = $1', [ap_id]);
      if (locResult.rows.length > 0) {
        locationId = locResult.rows[0].id;
      }
    }

    // Derive anonId from mac_address or generate a random anonymous id
    const anonId = mac_address
      ? `mac_${mac_address}`
      : `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Get or create user (reuse cache)
    let userId = await redis.get(`user:${anonId}`);
    if (!userId) {
      const userResult = await pool.query('SELECT id FROM users WHERE anon_id = $1', [anonId]);
      if (userResult.rows.length === 0) {
        const newUser = await pool.query('INSERT INTO users (anon_id) VALUES ($1) RETURNING id', [anonId]);
        userId = newUser.rows[0].id;
      } else {
        userId = userResult.rows[0].id;
      }
      await redis.set(`user:${anonId}`, userId, { EX: 7 * 24 * 3600 });
    }

    // Create session
    const sessionResult = await pool.query(
      'INSERT INTO sessions (user_id, location_id, device_type, user_agent) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, locationId || null, device_type || null, req.headers['user-agent'] || null]
    );
    const sessionId = sessionResult.rows[0].id;
    await redis.set(`session:${sessionId}`, userId, { EX: 24 * 3600 });

    // First-time detection (survey_required)
    const surveyResult = await pool.query('SELECT id FROM surveys WHERE user_id = $1', [userId]);
    const survey_required = surveyResult.rows.length === 0;

    // Get active campaigns (with targeting)
    const campaignsResult = await pool.query(
      `
        SELECT id, name, status, start_time, end_time, targeting, ab_test_variants, created_at
        FROM campaigns
        WHERE status = 'active'
          AND (start_time IS NULL OR start_time <= now())
          AND (end_time IS NULL OR end_time >= now())
        ORDER BY created_at DESC
      `
    );

    const campaigns = campaignsResult.rows.filter((c) => {
      if (!c.targeting || Object.keys(c.targeting).length === 0) return true;
      const t = c.targeting;
      if (t.locationIds && locationId && !t.locationIds.includes(locationId)) return false;
      if (t.deviceTypes && device_type && !t.deviceTypes.includes(device_type)) return false;
      if (t.firstTimeOnly !== undefined && t.firstTimeOnly !== survey_required) return false;
      return true;
    });

    const ads_list = campaigns.map((c) => {
      // pick first variant if exists
      if (c.ab_test_variants && c.ab_test_variants.length > 0) {
        return { id: c.id, name: c.name, content: c.ab_test_variants[0].content || c.ab_test_variants[0] };
      }
      return { id: c.id, name: c.name, content: { text: c.name } };
    });

    res.json({ session_id: sessionId, ads_list, survey_required });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Captive Portal: submit survey (per yeucau.md)
app.post('/api/captive/submit-survey', async (req, res) => {
  const { session_id, answers } = req.body || {};
  try {
    const sessionResult = await pool.query('SELECT user_id FROM sessions WHERE id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const userId = sessionResult.rows[0].user_id;

    const existing = await pool.query('SELECT id FROM surveys WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Survey already submitted' });
    }

    await pool.query('INSERT INTO surveys (user_id, session_id, answers) VALUES ($1, $2, $3)', [
      userId,
      session_id,
      JSON.stringify(answers || {}),
    ]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/track/impression', async (req, res) => {
  const { campaignId, sessionId } = req.body || {};
  try {
    await pool.query('INSERT INTO impressions (campaign_id, session_id) VALUES ($1, $2)', [campaignId, sessionId || null]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/track/click', async (req, res) => {
  const { campaignId, sessionId } = req.body || {};
  try {
    await pool.query('INSERT INTO clicks (campaign_id, session_id) VALUES ($1, $2)', [campaignId, sessionId || null]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create or get session
app.post('/sessions', async (req, res) => {
  const { anonId, locationId, deviceType, userAgent } = req.body || {};
  try {
    // Try cache first
    let userId = await redis.get(`user:${anonId}`);
    if (!userId) {
      // Get or create user in DB
      let userResult = await pool.query('SELECT id FROM users WHERE anon_id = $1', [anonId]);
      if (userResult.rows.length === 0) {
        const newUser = await pool.query('INSERT INTO users (anon_id) VALUES ($1) RETURNING id', [anonId]);
        userId = newUser.rows[0].id;
      } else {
        userId = userResult.rows[0].id;
      }
      // Cache mapping for 7 days
      await redis.set(`user:${anonId}`, userId, { EX: 7 * 24 * 3600 });
    }

    // Create session
    const sessionResult = await pool.query(
      'INSERT INTO sessions (user_id, location_id, device_type, user_agent) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, locationId || null, deviceType || null, userAgent || null]
    );
    const sessionId = sessionResult.rows[0].id;
    // Cache session -> user for 24h
    await redis.set(`session:${sessionId}`, userId, { EX: 24 * 3600 });

    // Check if first-time visit (no survey exists)
    const surveyResult = await pool.query('SELECT id FROM surveys WHERE user_id = $1', [userId]);
    const isFirstTime = surveyResult.rows.length === 0;

    res.json({ ok: true, sessionId, userId, isFirstTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Submit survey (first-time only)
app.post('/surveys', async (req, res) => {
  const { userId, sessionId, answers } = req.body || {};
  try {
    // Check if survey already exists
    const existing = await pool.query('SELECT id FROM surveys WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Survey already submitted' });
    }

    await pool.query(
      'INSERT INTO surveys (user_id, session_id, answers) VALUES ($1, $2, $3)',
      [userId, sessionId || null, JSON.stringify(answers || {})]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tracking Service aliases per yeucau.md
app.post('/api/tracking/session-start', async (req, res) => {
  const { anonId, mac_address, locationId, deviceType, userAgent } = req.body || {};
  try {
    const effectiveAnon = anonId || (mac_address ? `mac_${mac_address}` : `anon_${Date.now()}`);

    let userId = await redis.get(`user:${effectiveAnon}`);
    if (!userId) {
      const userResult = await pool.query('SELECT id FROM users WHERE anon_id = $1', [effectiveAnon]);
      if (userResult.rows.length === 0) {
        const newUser = await pool.query('INSERT INTO users (anon_id) VALUES ($1) RETURNING id', [effectiveAnon]);
        userId = newUser.rows[0].id;
      } else {
        userId = userResult.rows[0].id;
      }
      await redis.set(`user:${effectiveAnon}`, userId, { EX: 7 * 24 * 3600 });
    }

    const sessionResult = await pool.query(
      'INSERT INTO sessions (user_id, location_id, device_type, user_agent) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, locationId || null, deviceType || null, userAgent || null]
    );
    const sessionId = sessionResult.rows[0].id;
    await redis.set(`session:${sessionId}`, userId, { EX: 24 * 3600 });

    const surveyResult = await pool.query('SELECT id FROM surveys WHERE user_id = $1', [userId]);
    const isFirstTime = surveyResult.rows.length === 0;

    res.json({ ok: true, sessionId, userId, isFirstTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracking/session-end', async (req, res) => {
  const { session_id } = req.body || {};
  try {
    await pool.query('UPDATE sessions SET ended_at = now() WHERE id = $1', [session_id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracking/impression', async (req, res) => {
  const { campaignId, sessionId } = req.body || {};
  try {
    await pool.query('INSERT INTO impressions (campaign_id, session_id) VALUES ($1, $2)', [campaignId, sessionId || null]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracking/click', async (req, res) => {
  const { campaignId, sessionId } = req.body || {};
  try {
    await pool.query('INSERT INTO clicks (campaign_id, session_id) VALUES ($1, $2)', [campaignId, sessionId || null]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analytics aliases per yeucau.md
app.get('/api/analytics/kpi', async (_req, res) => {
  try {
    const totalImpr = await pool.query('SELECT COUNT(*)::int AS c FROM impressions');
    const totalClicks = await pool.query('SELECT COUNT(*)::int AS c FROM clicks');
    const totalSessions = await pool.query('SELECT COUNT(*)::int AS c FROM sessions');
    const todayImpr = await pool.query("SELECT COUNT(*)::int AS c FROM impressions WHERE shown_at::date = now()::date");
    const todayClicks = await pool.query("SELECT COUNT(*)::int AS c FROM clicks WHERE clicked_at::date = now()::date");
    const todaySessions = await pool.query("SELECT COUNT(*)::int AS c FROM sessions WHERE started_at::date = now()::date");

    res.json({
      totals: {
        impressions: totalImpr.rows[0].c,
        clicks: totalClicks.rows[0].c,
        sessions: totalSessions.rows[0].c,
      },
      today: {
        impressions: todayImpr.rows[0].c,
        clicks: todayClicks.rows[0].c,
        sessions: todaySessions.rows[0].c,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/heatmap', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.name, l.latitude, l.longitude, COUNT(s.id)::int AS sessions_today
       FROM locations l
       LEFT JOIN sessions s ON s.location_id = l.id AND s.started_at::date = now()::date
       GROUP BY l.id, l.name, l.latitude, l.longitude
       HAVING l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       ORDER BY sessions_today DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/report', async (_req, res) => {
  res.redirect('/export/report.pdf');
});

// Analytics: geofencing (locations within radius km)
app.get('/api/analytics/geofence', async (req, res) => {
  const centerLat = parseFloat(req.query.center_lat);
  const centerLng = parseFloat(req.query.center_lng);
  const radiusKm = parseFloat(req.query.radius_km || '1');
  if (Number.isNaN(centerLat) || Number.isNaN(centerLng)) {
    return res.status(400).json({ error: 'center_lat and center_lng are required' });
  }
  try {
    const locs = await pool.query(
      `SELECT l.id, l.name, l.latitude, l.longitude,
              COUNT(s.id)::int AS sessions_today
       FROM locations l
       LEFT JOIN sessions s ON s.location_id = l.id AND s.started_at::date = now()::date
       WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       GROUP BY l.id, l.name, l.latitude, l.longitude`
    );
    const within = locs.rows
      .map((l) => {
        const dist = haversineDistanceKm(centerLat, centerLng, parseFloat(l.latitude), parseFloat(l.longitude));
        return { ...l, distance_km: dist };
      })
      .filter((l) => l.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);
    res.json({ center_lat: centerLat, center_lng: centerLng, radius_km: radiusKm, locations: within });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analytics: clustering (grid-based)
app.get('/api/analytics/clusters', async (_req, res) => {
  const grid = 0.02; // degrees ~2km
  try {
    const locs = await pool.query(
      `SELECT l.id, l.name, l.latitude, l.longitude,
              COUNT(s.id)::int AS sessions_today
       FROM locations l
       LEFT JOIN sessions s ON s.location_id = l.id AND s.started_at::date = now()::date
       WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       GROUP BY l.id, l.name, l.latitude, l.longitude`
    );
    const clusters = {};
    for (const l of locs.rows) {
      const lat = parseFloat(l.latitude);
      const lng = parseFloat(l.longitude);
      const key = `${Math.round(lat / grid) * grid}_${Math.round(lng / grid) * grid}`;
      if (!clusters[key]) {
        clusters[key] = { cluster_id: key, locations: [], sessions_today: 0 };
      }
      clusters[key].locations.push(l);
      clusters[key].sessions_today += l.sessions_today;
    }
    res.json(Object.values(clusters));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analytics: segmentation
app.get('/api/analytics/segments', async (_req, res) => {
  try {
    const deviceSeg = await pool.query(
      `SELECT COALESCE(device_type, 'unknown') AS device_type, COUNT(*)::int AS sessions
       FROM sessions GROUP BY device_type`
    );
    const firstTimeSeg = await pool.query(
      `SELECT CASE WHEN sv.id IS NULL THEN 'first_time' ELSE 'repeat' END AS segment, COUNT(s.id)::int AS sessions
       FROM sessions s
       LEFT JOIN surveys sv ON sv.user_id = s.user_id
       GROUP BY segment`
    );
    res.json({ device: deviceSeg.rows, first_time: firstTimeSeg.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Monetization summary (CPM/CPC)
app.get('/api/monetization/summary', async (_req, res) => {
  const cpm = parseFloat(process.env.MONETIZATION_CPM || '2'); // $ per 1000 impressions
  const cpc = parseFloat(process.env.MONETIZATION_CPC || '0.05'); // $ per click
  try {
    const impr = await pool.query('SELECT COUNT(*)::int AS c FROM impressions');
    const clicks = await pool.query('SELECT COUNT(*)::int AS c FROM clicks');
    const impressions = impr.rows[0].c;
    const clicksCount = clicks.rows[0].c;
    const revenue = (impressions / 1000) * cpm + clicksCount * cpc;
    res.json({ impressions, clicks: clicksCount, cpm, cpc, estimated_revenue: Number(revenue.toFixed(2)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Monitoring / HA
app.get('/api/monitoring/status', async (_req, res) => {
  const status = { services: {}, alerts: [] };
  try {
    status.services.database = 'unknown';
    await pool.query('SELECT 1');
    status.services.database = 'up';
  } catch (e) {
    status.services.database = 'down';
    status.alerts.push({ type: 'service', severity: 'critical', message: `Database down: ${e.message}` });
  }
  try {
    await redis.ping();
    status.services.redis = 'up';
  } catch (e) {
    status.services.redis = 'down';
    status.alerts.push({ type: 'service', severity: 'critical', message: `Redis down: ${e.message}` });
  }
  const services = await Promise.all([
    checkHttpHealth('http://campaign-api:3000/health', 'campaign-api'),
    checkHttpHealth('http://tracking-service:3001/health', 'tracking-service'),
  ]);
  services.forEach((svc) => {
    status.services[svc.label] = svc.status;
    if (svc.status === 'down') status.alerts.push({ type: 'service', severity: 'critical', message: `${svc.label} ${svc.detail || ''}` });
  });
  res.json(status);
});

// Simple KPI summary
app.get('/kpi', async (_req, res) => {
  try {
    const totalImpr = await pool.query('SELECT COUNT(*)::int AS c FROM impressions');
    const totalClicks = await pool.query('SELECT COUNT(*)::int AS c FROM clicks');
    const totalSessions = await pool.query('SELECT COUNT(*)::int AS c FROM sessions');
    const todayImpr = await pool.query("SELECT COUNT(*)::int AS c FROM impressions WHERE shown_at::date = now()::date");
    const todayClicks = await pool.query("SELECT COUNT(*)::int AS c FROM clicks WHERE clicked_at::date = now()::date");
    const todaySessions = await pool.query("SELECT COUNT(*)::int AS c FROM sessions WHERE started_at::date = now()::date");

    res.json({
      totals: {
        impressions: totalImpr.rows[0].c,
        clicks: totalClicks.rows[0].c,
        sessions: totalSessions.rows[0].c,
      },
      today: {
        impressions: todayImpr.rows[0].c,
        clicks: todayClicks.rows[0].c,
        sessions: todaySessions.rows[0].c,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analytics endpoints for Admin Portal
app.get('/analytics/sessions', async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  try {
    const result = await pool.query(
      `SELECT s.*, u.anon_id, l.name as location_name, b.name as brand_name
       FROM sessions s
       LEFT JOIN users u ON s.user_id = u.id
       LEFT JOIN locations l ON s.location_id = l.id
       LEFT JOIN brands b ON l.brand_id = b.id
       ORDER BY s.started_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/analytics/surveys', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.anon_id, se.started_at as session_started
       FROM surveys s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN sessions se ON s.session_id = se.id
       ORDER BY s.submitted_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/analytics/campaigns/:campaignId', async (req, res) => {
  const { campaignId } = req.params;
  try {
    const impr = await pool.query('SELECT COUNT(*)::int AS c FROM impressions WHERE campaign_id = $1', [campaignId]);
    const clicks = await pool.query('SELECT COUNT(*)::int AS c FROM clicks WHERE campaign_id = $1', [campaignId]);
    res.json({
      impressions: impr.rows[0].c,
      clicks: clicks.rows[0].c,
      ctr: impr.rows[0].c > 0 ? ((clicks.rows[0].c / impr.rows[0].c) * 100).toFixed(2) : 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Heatmap: aggregate sessions by location with coordinates and counts (today)
app.get('/analytics/heatmap', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.name, l.latitude, l.longitude, COUNT(s.id)::int AS sessions_today
       FROM locations l
       LEFT JOIN sessions s ON s.location_id = l.id AND s.started_at::date = now()::date
       GROUP BY l.id, l.name, l.latitude, l.longitude
       HAVING l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       ORDER BY sessions_today DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export CSV endpoints
app.get('/export/sessions.csv', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, u.anon_id, l.name as location, s.device_type, s.started_at, s.ended_at
       FROM sessions s
       LEFT JOIN users u ON s.user_id = u.id
       LEFT JOIN locations l ON s.location_id = l.id
       ORDER BY s.started_at DESC
       LIMIT 10000`
    );
    
    // Generate CSV
    const headers = ['ID', 'User ID', 'Location', 'Device Type', 'Started At', 'Ended At'];
    const rows = result.rows.map(r => [
      r.id, r.anon_id || '', r.location || '', r.device_type || '', 
      r.started_at ? new Date(r.started_at).toISOString() : '', 
      r.ended_at ? new Date(r.ended_at).toISOString() : ''
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sessions.csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/export/surveys.csv', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, u.anon_id, s.answers, s.submitted_at
       FROM surveys s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.submitted_at DESC`
    );
    
    const headers = ['ID', 'User ID', 'Answers (JSON)', 'Submitted At'];
    const rows = result.rows.map(r => [
      r.id, r.anon_id || '', JSON.stringify(r.answers), 
      r.submitted_at ? new Date(r.submitted_at).toISOString() : ''
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=surveys.csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/export/campaigns.csv', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.status, b.name as brand_name,
       COUNT(DISTINCT i.id)::int AS impressions,
       COUNT(DISTINCT cl.id)::int AS clicks,
       c.start_time, c.end_time, c.created_at
       FROM campaigns c
       LEFT JOIN brands b ON c.brand_id = b.id
       LEFT JOIN impressions i ON i.campaign_id = c.id
       LEFT JOIN clicks cl ON cl.campaign_id = c.id
       GROUP BY c.id, c.name, c.status, b.name, c.start_time, c.end_time, c.created_at
       ORDER BY c.created_at DESC`
    );
    
    const headers = ['ID', 'Name', 'Status', 'Brand', 'Impressions', 'Clicks', 'CTR %', 'Start Time', 'End Time', 'Created At'];
    const rows = result.rows.map(r => {
      const ctr = r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : '0';
      return [
        r.id, r.name, r.status, r.brand_name || '', r.impressions, r.clicks, ctr,
        r.start_time ? new Date(r.start_time).toISOString() : '',
        r.end_time ? new Date(r.end_time).toISOString() : '',
        r.created_at ? new Date(r.created_at).toISOString() : ''
      ];
    });
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=campaigns.csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/export/report.pdf', async (_req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM sessions) AS sessions_total,
        (SELECT COUNT(*) FROM impressions) AS impressions_total,
        (SELECT COUNT(*) FROM clicks) AS clicks_total
    `);
    const today = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE started_at::date = now()::date) AS sessions_today,
        (SELECT COUNT(*) FROM impressions WHERE shown_at::date = now()::date) AS impressions_today,
        (SELECT COUNT(*) FROM clicks WHERE clicked_at::date = now()::date) AS clicks_today
    `);
    const topCampaigns = await pool.query(`
      SELECT c.name, COUNT(i.id)::int AS impressions, COUNT(cl.id)::int AS clicks
      FROM campaigns c
      LEFT JOIN impressions i ON i.campaign_id = c.id
      LEFT JOIN clicks cl ON cl.campaign_id = c.id
      GROUP BY c.id
      ORDER BY impressions DESC
      LIMIT 5
    `);
    const heatmap = await pool.query(`
      SELECT l.name, COUNT(s.id)::int AS sessions
      FROM locations l
      LEFT JOIN sessions s ON s.location_id = l.id AND s.started_at::date = now()::date
      GROUP BY l.id
      ORDER BY sessions DESC
      LIMIT 5
    `);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=wifi-report.pdf');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text('tiNi Wi-Fi Marketing Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    const totalRow = totals.rows[0];
    const todayRow = today.rows[0];
    doc.fontSize(16).text('Overall Totals');
    doc.fontSize(12).list([
      `Sessions: ${totalRow.sessions_total}`,
      `Impressions: ${totalRow.impressions_total}`,
      `Clicks: ${totalRow.clicks_total}`
    ]);
    doc.moveDown();

    doc.fontSize(16).text('Today');
    doc.fontSize(12).list([
      `Sessions: ${todayRow.sessions_today}`,
      `Impressions: ${todayRow.impressions_today}`,
      `Clicks: ${todayRow.clicks_today}`
    ]);
    doc.moveDown();

    doc.fontSize(16).text('Top Campaigns');
    topCampaigns.rows.forEach((c, idx) => {
      const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0';
      doc.fontSize(12).text(`${idx + 1}. ${c.name} – Impr: ${c.impressions}, Clicks: ${c.clicks}, CTR: ${ctr}%`);
    });
    doc.moveDown();

    doc.fontSize(16).text('Top Locations (Today)');
    heatmap.rows.forEach((l, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${l.name} – Sessions: ${l.sessions}`);
    });

    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Alerts: KPI thresholds + service health
app.get('/alerts', async (_req, res) => {
  const alerts = [];
  try {
    // KPI checks (today)
    const todaySessions = await pool.query("SELECT COUNT(*)::int AS c FROM sessions WHERE started_at::date = now()::date");
    const todayImpr = await pool.query("SELECT COUNT(*)::int AS c FROM impressions WHERE shown_at::date = now()::date");
    const todayClicks = await pool.query("SELECT COUNT(*)::int AS c FROM clicks WHERE clicked_at::date = now()::date");

    if (todaySessions.rows[0].c < 10) {
      alerts.push({ type: 'kpi', severity: 'warning', message: `Low sessions today (${todaySessions.rows[0].c})` });
    }
    if (todayImpr.rows[0].c < 20) {
      alerts.push({ type: 'kpi', severity: 'warning', message: `Low impressions today (${todayImpr.rows[0].c})` });
    }
    if (todayClicks.rows[0].c === 0 && todayImpr.rows[0].c > 0) {
      alerts.push({ type: 'kpi', severity: 'warning', message: 'No clicks recorded today' });
    }

    // Service health
    const services = await Promise.all([
      checkHttpHealth('http://campaign-api:3000/health', 'Campaign API'),
      checkHttpHealth('http://tracking-service:3001/health', 'Tracking Service (self)'),
    ]);

    for (const svc of services) {
      if (svc.status === 'down') {
        alerts.push({ type: 'service', severity: 'critical', message: `${svc.label} is down (${svc.detail || 'no detail'})` });
      }
    }

    // Redis health
    try {
      await redis.ping();
    } catch (e) {
      alerts.push({ type: 'service', severity: 'critical', message: `Redis not responding (${e.message})` });
    }

    res.json({ alerts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`tracking-service listening on ${port}`));



