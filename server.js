const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { FinOpsDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve DB path (Support serverless /tmp on Vercel/AWS Lambda)
let DB_FILE = process.env.DB_PATH || path.join(__dirname, 'costs.db');
if (process.env.VERCEL) {
  const tmpDb = '/tmp/costs.db';
  if (!fs.existsSync(tmpDb)) {
    const bundledDb = path.join(__dirname, 'costs.db');
    if (fs.existsSync(bundledDb)) {
      try {
        fs.copyFileSync(bundledDb, tmpDb);
      } catch (e) {
        console.warn('Could not copy bundled DB to /tmp, will re-seed:', e.message);
      }
    }
  }
  DB_FILE = tmpDb;
}

// Ensure database exists and is seeded if not present
if (!fs.existsSync(DB_FILE)) {
  console.log('Database not found. Triggering automated seed...');
  const { seedDatabase } = require('./seed');
  seedDatabase(DB_FILE);
}

const db = new FinOpsDB(DB_FILE);

// If database is empty, seed it
if (db.getRecordCount() === 0) {
  console.log('Database is empty. Populating initial seed...');
  const { seedDatabase } = require('./seed');
  seedDatabase(DB_FILE);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS Headers for API flexibility
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// --- API Endpoints ---

// 1. Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      type: 'SQLite (Node.js v22 built-in engine)',
      totalRecords: db.getRecordCount()
    }
  });
});

// 2. Executive FinOps KPIs
app.get('/api/kpi', (req, res) => {
  try {
    const kpis = db.getKPIs();
    res.json({ success: true, data: kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Daily Spend Trend Area Chart
app.get('/api/trends', (req, res) => {
  try {
    let days = 30;
    const range = (req.query.range || '30d').toLowerCase();
    if (range === '60d') days = 60;
    else if (range === '90d') days = 90;
    else if (range === '180d') days = 180;
    else if (!isNaN(parseInt(range))) days = parseInt(range);

    const trends = db.getDailyTrends(days);
    res.json({ success: true, range: `${days}d`, count: trends.length, data: trends });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Provider Spend Split (Donut Chart)
app.get('/api/breakdown/provider', (req, res) => {
  try {
    const data = db.getProviderBreakdown();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Top Cost-Driving Services (Horizontal Bar Chart)
app.get('/api/breakdown/services', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const data = db.getTopServices(limit);
    res.json({ success: true, limit, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Category Breakdown (Progress Bars)
app.get('/api/breakdown/categories', (req, res) => {
  try {
    const data = db.getCategoryBreakdown();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Anomaly Detection Center
app.get('/api/anomalies', (req, res) => {
  try {
    const status = req.query.status || 'all';
    const anomalies = db.getAnomalies(status);
    res.json({ success: true, filter: status, count: anomalies.length, data: anomalies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Anomaly Status (Resolved / Reopen)
app.post('/api/anomalies/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = db.toggleAnomalyStatus(id);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Anomaly not found' });
    }
    const kpis = db.getKPIs();
    res.json({
      success: true,
      message: `Anomaly #${id} is now ${updated.status}`,
      data: updated,
      kpis
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run Statistical Anomaly Scanner
app.post('/api/anomalies/scan', (req, res) => {
  try {
    const detected = db.runStatisticalAnomalyDetection();
    let newInserted = 0;
    for (const anom of detected) {
      // Check if already in anomalies table for same date and service
      const existing = db.db.prepare('SELECT id FROM anomalies WHERE date = ? AND service = ?').get(anom.date, anom.service);
      if (!existing) {
        db.insertAnomaly(anom);
        newInserted++;
      }
    }
    const allAnomalies = db.getAnomalies('all');
    res.json({
      success: true,
      detectedCount: detected.length,
      newInserted,
      totalAnomalies: allAnomalies.length,
      data: allAnomalies
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Cost Optimization Recommendations
app.get('/api/recommendations', (req, res) => {
  try {
    const recommendations = db.getRecommendations();
    res.json({ success: true, count: recommendations.length, data: recommendations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Apply or Rollback Recommendation (Real-time ROI recalculation)
app.post('/api/recommendations/:id/apply', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = db.applyRecommendation(id);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Recommendation not found' });
    }
    const kpis = db.getKPIs();
    res.json({
      success: true,
      message: updated.status === 'applied' 
        ? `Applied: ${updated.title} (+$${updated.monthly_savings}/mo realized)`
        : `Rolled back: ${updated.title}`,
      data: updated,
      kpis
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Multi-Cloud Ingestion API
app.post('/api/ingest', (req, res) => {
  try {
    const { date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id, tags } = req.body;
    if (!date || !provider || !service || !category || !region || cost === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required billing record fields' });
    }

    const record = {
      date,
      provider,
      service,
      category,
      region,
      cost: parseFloat(cost),
      usage_amount: parseFloat(usage_amount || 0),
      usage_unit: usage_unit || 'Units',
      resource_id: resource_id || `custom-${Date.now()}`,
      tags: tags || {}
    };

    db.insertBillingRecord(record);
    const kpis = db.getKPIs();
    res.status(201).json({ success: true, message: 'Record ingested successfully', record, kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Export Hub: CSV Download
app.get('/api/export/csv', (req, res) => {
  try {
    const records = db.getAllRecords(20000);
    const headers = ['id', 'date', 'provider', 'service', 'category', 'region', 'cost', 'usage_amount', 'usage_unit', 'resource_id', 'tags'];
    
    let csvContent = headers.join(',') + '\n';
    for (const r of records) {
      const row = [
        r.id,
        r.date,
        `"${r.provider}"`,
        `"${r.service}"`,
        `"${r.category}"`,
        `"${r.region}"`,
        r.cost.toFixed(2),
        r.usage_amount.toFixed(2),
        `"${r.usage_unit}"`,
        `"${r.resource_id}"`,
        `"${(r.tags || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    }

    const filename = `finops-cloud-costs-audit-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Export Hub: JSON Download
app.get('/api/export/json', (req, res) => {
  try {
    const kpis = db.getKPIs();
    const providers = db.getProviderBreakdown();
    const services = db.getTopServices(10);
    const categories = db.getCategoryBreakdown();
    const anomalies = db.getAnomalies('all');
    const recommendations = db.getRecommendations();
    const dateRange = db.getDateRange();

    const report = {
      meta: {
        platform: 'Cloud Cost Optimization & FinOps Analytics Platform',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        dateRange,
        engine: 'Node.js v22 built-in SQLite engine'
      },
      executiveSummaryKPIs: kpis,
      multiCloudBreakdown: {
        byProvider: providers,
        byCategory: categories,
        topCostDrivers: services
      },
      anomalyDetectionCenter: {
        total: anomalies.length,
        items: anomalies
      },
      costOptimizationHub: {
        totalOpportunities: recommendations.length,
        items: recommendations
      }
    };

    const filename = `finops-executive-audit-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(report, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  FinOps Cloud Cost Optimization Platform Started`);
    console.log(`  Live URL: http://localhost:${PORT}`);
    console.log(`  Engine: Node.js ${process.version} with node:sqlite`);
    console.log(`  Database: ${DB_FILE}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
