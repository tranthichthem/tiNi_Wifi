import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Simple admin auth via X-Admin-Token header mapped to admin_users.api_token
async function authAdmin(req, res, next) {
  try {
    const token = req.header('X-Admin-Token');
    if (!token) return res.status(401).json({ error: 'Missing admin token' });
    const result = await pool.query('SELECT id, email, role, brand_id FROM admin_users WHERE api_token = $1', [token]);
    if (result.rows.length === 0) return res.status(403).json({ error: 'Invalid token' });
    req.admin = result.rows[0];
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'campaign-api' });
});

// Get active campaigns for captive portal (with targeting)
app.get('/campaigns/active', async (req, res) => {
  const { locationId, deviceType, isFirstTime } = req.query;
  try {
    let query = `
      SELECT id, name, status, start_time, end_time, targeting, ab_test_variants, created_at
      FROM campaigns
      WHERE status = 'active'
        AND (start_time IS NULL OR start_time <= now())
        AND (end_time IS NULL OR end_time >= now())
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    
    // Filter by targeting if provided
    let campaigns = result.rows.filter(c => {
      if (!c.targeting || Object.keys(c.targeting).length === 0) return true;
      const t = c.targeting;
      if (t.locationIds && locationId && !t.locationIds.includes(locationId)) return false;
      if (t.deviceTypes && deviceType && !t.deviceTypes.includes(deviceType)) return false;
      if (t.firstTimeOnly !== undefined && t.firstTimeOnly !== (isFirstTime === 'true')) return false;
      return true;
    });

    res.json(campaigns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CRUD endpoints
app.get('/campaigns', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, name, status, created_at FROM campaigns ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/campaigns/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/campaigns', authAdmin, async (req, res) => {
  const { brandId, name, status, startTime, endTime, targeting, abTestVariants } = req.body || {};
  try {
    const result = await pool.query(
      'INSERT INTO campaigns (brand_id, name, status, start_time, end_time, targeting, ab_test_variants) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [brandId, name, status || 'draft', startTime || null, endTime || null, JSON.stringify(targeting || {}), JSON.stringify(abTestVariants || [])]
    );
    // audit
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'create_campaign', result.rows[0].id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/campaigns/:id', authAdmin, async (req, res) => {
  const { name, status, startTime, endTime, targeting, abTestVariants } = req.body || {};
  try {
    const result = await pool.query(
      'UPDATE campaigns SET name = COALESCE($1, name), status = COALESCE($2, status), start_time = COALESCE($3, start_time), end_time = COALESCE($4, end_time), targeting = COALESCE($5, targeting), ab_test_variants = COALESCE($6, ab_test_variants) WHERE id = $7 RETURNING *',
      [name, status, startTime, endTime, targeting ? JSON.stringify(targeting) : null, abTestVariants ? JSON.stringify(abTestVariants) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'update_campaign', req.params.id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/campaigns/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'delete_campaign', req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Aliases per yeucau.md (singular /campaign)
app.post('/campaign', authAdmin, async (req, res) => {
  const { brandId, name, status, startTime, endTime, targeting, abTestVariants } = req.body || {};
  try {
    const result = await pool.query(
      'INSERT INTO campaigns (brand_id, name, status, start_time, end_time, targeting, ab_test_variants) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [brandId, name, status || 'draft', startTime || null, endTime || null, JSON.stringify(targeting || {}), JSON.stringify(abTestVariants || [])]
    );
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'create_campaign', result.rows[0].id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/campaign/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/campaign/:id', authAdmin, async (req, res) => {
  const { name, status, startTime, endTime, targeting, abTestVariants } = req.body || {};
  try {
    const result = await pool.query(
      'UPDATE campaigns SET name = COALESCE($1, name), status = COALESCE($2, status), start_time = COALESCE($3, start_time), end_time = COALESCE($4, end_time), targeting = COALESCE($5, targeting), ab_test_variants = COALESCE($6, ab_test_variants) WHERE id = $7 RETURNING *',
      [name, status, startTime, endTime, targeting ? JSON.stringify(targeting) : null, abTestVariants ? JSON.stringify(abTestVariants) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'update_campaign', req.params.id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/campaign/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'delete_campaign', req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Brands endpoints
app.get('/brands', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM brands ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/brands', authAdmin, async (req, res) => {
  const { name } = req.body || {};
  try {
    const result = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING *', [name]);
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'create_brand', result.rows[0].id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/brands/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM brands WHERE id = $1', [req.params.id]);
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'delete_brand', req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Locations endpoints
app.get('/locations', async (req, res) => {
  const { brandId } = req.query;
  try {
    let query = 'SELECT l.*, b.name as brand_name FROM locations l JOIN brands b ON l.brand_id = b.id';
    let params = [];
    if (brandId) {
      query += ' WHERE l.brand_id = $1';
      params.push(brandId);
    }
    query += ' ORDER BY l.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/locations', authAdmin, async (req, res) => {
  const { brandId, name, address, apIdentifier } = req.body || {};
  try {
    const result = await pool.query(
      'INSERT INTO locations (brand_id, name, address, ap_identifier) VALUES ($1, $2, $3, $4) RETURNING *',
      [brandId, name, address || null, apIdentifier || null]
    );
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'create_location', result.rows[0].id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/locations/:id', authAdmin, async (req, res) => {
  const { name, address, apIdentifier } = req.body || {};
  try {
    const result = await pool.query(
      'UPDATE locations SET name = COALESCE($1, name), address = COALESCE($2, address), ap_identifier = COALESCE($3, ap_identifier) WHERE id = $4 RETURNING *',
      [name, address, apIdentifier, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'update_location', req.params.id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/locations/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM locations WHERE id = $1', [req.params.id]);
    await pool.query('INSERT INTO audit_logs (actor, action, target) VALUES ($1, $2, $3)', [req.admin.email, 'delete_location', req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Audit logs list (admin only)
app.get('/audit-logs', authAdmin, async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  try {
    const result = await pool.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [parseInt(limit), parseInt(offset)]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`campaign-api listening on ${port}`));



