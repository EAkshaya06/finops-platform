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

// CORS Headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper for extracting query filters
function extractFilters(query) {
  return {
    month: query.month && query.month !== 'all' ? query.month : null,
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    provider: query.provider || 'all',
    search: query.search || '',
    sortBy: query.sortBy || 'cost_desc'
  };
}

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

// 2. Available Months
app.get('/api/months', (req, res) => {
  try {
    const months = db.getAvailableMonths();
    res.json({ success: true, data: months });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Executive FinOps KPIs (Supports Date & Provider Filters)
app.get('/api/kpi', (req, res) => {
  try {
    const filters = extractFilters(req.query);
    const kpis = db.getKPIs(filters);
    res.json({ success: true, data: kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Monthly Cost Comparison
app.get('/api/comparison', (req, res) => {
  try {
    const comparison = db.getMonthlyComparison();
    res.json({ success: true, data: comparison });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Budget Management
app.get('/api/budget', (req, res) => {
  try {
    const month = req.query.month || null;
    const status = db.getBudgetStatus(month);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/budget', (req, res) => {
  try {
    const { month, amount } = req.body;
    if (amount === undefined || isNaN(parseFloat(amount)) || parseFloat(amount) < 0) {
      return res.status(400).json({ success: false, error: 'Budget amount must be a non-negative number.' });
    }
    const targetMonth = month || db.getLatestMonth() || new Date().toISOString().slice(0, 7);
    const updated = db.setBudget(targetMonth, parseFloat(amount));
    res.json({ success: true, message: `Budget for ${targetMonth} updated successfully.`, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Savings Calculator (10%, 15%, 20% or custom)
app.get('/api/calculator', (req, res) => {
  try {
    const percentage = parseFloat(req.query.reduction || '10');
    const month = req.query.month || null;
    const calculation = db.calculateSavings(percentage, month);
    res.json({ success: true, data: calculation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Daily Spend Trend Area Chart
app.get('/api/trends', (req, res) => {
  try {
    let days = 30;
    const range = (req.query.range || '30d').toLowerCase();
    if (range === '60d') days = 60;
    else if (range === '90d') days = 90;
    else if (range === '180d') days = 180;
    else if (!isNaN(parseInt(range))) days = parseInt(range);

    const filters = extractFilters(req.query);
    const trends = db.getDailyTrends(days, filters);
    res.json({ success: true, range: `${days}d`, count: trends.length, data: trends });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Provider Spend Split (Donut Chart)
app.get('/api/breakdown/provider', (req, res) => {
  try {
    const filters = extractFilters(req.query);
    const data = db.getProviderBreakdown(filters);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Top 5 Costly Services (With Search and Sorting)
app.get('/api/breakdown/services', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const filters = extractFilters(req.query);
    const data = db.getTopServices(limit, filters);
    res.json({ success: true, limit, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Category Breakdown (Progress Bars)
app.get('/api/breakdown/categories', (req, res) => {
  try {
    const filters = extractFilters(req.query);
    const data = db.getCategoryBreakdown(filters);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Billing Record Management (CRUD)
app.get('/api/records', (req, res) => {
  try {
    const options = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || '',
      sortBy: req.query.sortBy || 'date_desc',
      month: req.query.month || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      provider: req.query.provider || 'all',
      category: req.query.category || 'all'
    };
    const result = db.getBillingRecords(options);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/records/:id', (req, res) => {
  try {
    const record = db.getRecordById(parseInt(req.params.id));
    if (!record) return res.status(404).json({ success: false, error: 'Record not found.' });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/records', (req, res) => {
  try {
    const { date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id } = req.body;
    
    // Strict input validation
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Valid billing date (YYYY-MM-DD) is required.' });
    }
    if (!provider || !['AWS', 'GCP', 'Azure'].includes(provider)) {
      return res.status(400).json({ success: false, error: 'Provider must be AWS, GCP, or Azure.' });
    }
    if (!service || service.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Service name is required.' });
    }
    if (!category || category.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Category is required.' });
    }
    if (cost === undefined || isNaN(parseFloat(cost)) || parseFloat(cost) < 0) {
      return res.status(400).json({ success: false, error: 'Cost must be a positive number.' });
    }

    const record = {
      date,
      provider,
      service: service.trim(),
      category: category.trim(),
      region: (region || 'us-east-1').trim(),
      cost: parseFloat(cost),
      usage_amount: parseFloat(usage_amount || 0),
      usage_unit: (usage_unit || 'Units').trim(),
      resource_id: (resource_id || `res-${Date.now()}`).trim(),
      tags: { source: 'manual-entry' }
    };

    db.insertBillingRecord(record);
    const kpis = db.getKPIs();
    res.status(201).json({ success: true, message: 'Billing record created successfully.', record, kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/records/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id } = req.body;

    if (cost !== undefined && (isNaN(parseFloat(cost)) || parseFloat(cost) < 0)) {
      return res.status(400).json({ success: false, error: 'Cost must be a positive number.' });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Valid date (YYYY-MM-DD) required.' });
    }

    const updated = db.updateBillingRecord(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Record not found.' });
    }

    const kpis = db.getKPIs();
    res.json({ success: true, message: `Record #${id} updated successfully.`, data: updated, kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/records/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = db.deleteBillingRecord(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Record not found.' });
    }
    const kpis = db.getKPIs();
    res.json({ success: true, message: `Record #${id} deleted successfully.`, kpis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Anomaly Detection Center
app.get('/api/anomalies', (req, res) => {
  try {
    const status = req.query.status || 'all';
    const anomalies = db.getAnomalies(status);
    res.json({ success: true, filter: status, count: anomalies.length, data: anomalies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

app.post('/api/anomalies/scan', (req, res) => {
  try {
    const detected = db.runStatisticalAnomalyDetection();
    let newInserted = 0;
    for (const anom of detected) {
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

// 13. Recommendations
app.get('/api/recommendations', (req, res) => {
  try {
    const recommendations = db.getRecommendations();
    res.json({ success: true, count: recommendations.length, data: recommendations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// 14. Export Hub: Filtered CSV Download
app.get('/api/export/csv', (req, res) => {
  try {
    const filters = extractFilters(req.query);
    const records = db.getAllRecords(20000, filters);
    const headers = ['id', 'date', 'provider', 'service', 'category', 'region', 'cost_usd', 'usage_amount', 'usage_unit', 'resource_id', 'tags'];
    
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

    const filename = `finops-billing-audit-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Export Hub: JSON Download
app.get('/api/export/json', (req, res) => {
  try {
    const filters = extractFilters(req.query);
    const kpis = db.getKPIs(filters);
    const providers = db.getProviderBreakdown(filters);
    const services = db.getTopServices(10, filters);
    const categories = db.getCategoryBreakdown(filters);
    const anomalies = db.getAnomalies('all');
    const recommendations = db.getRecommendations();
    const dateRange = db.getDateRange();
    const budgetStatus = db.getBudgetStatus();
    const monthlyComparison = db.getMonthlyComparison();

    const report = {
      meta: {
        platform: 'Cloud Cost Optimization & FinOps Analytics Platform',
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        dateRange,
        engine: 'Node.js v22 built-in SQLite engine'
      },
      executiveSummaryKPIs: kpis,
      budgetStatus,
      monthlyComparison,
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

// 16. Printable Executive PDF Report View
app.get('/api/export/report', (req, res) => {
  try {
    const kpis = db.getKPIs();
    const budget = db.getBudgetStatus();
    const comparison = db.getMonthlyComparison();
    const topServices = db.getTopServices(5);
    const anomalies = db.getAnomalies('open');
    const recommendations = db.getRecommendations();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FinOps Cloud Cost Optimization Audit Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; color: #1e293b; background: #fff; }
    .header { border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    h1 { margin: 0; font-size: 24px; color: #0f172a; }
    .subtitle { color: #64748b; font-size: 13px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .kpi-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .kpi-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .kpi-value { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; }
    .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .badge-aws { background: #fef3c7; color: #b45309; }
    .badge-gcp { background: #dbeafe; color: #1d4ed8; }
    .badge-azure { background: #e0f2fe; color: #0369a1; }
    .badge-alert { background: #fee2e2; color: #b91c1c; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print {
      body { margin: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: flex-end; gap: 10px;">
    <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;">Print / Save as PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>FinOps Cloud Cost Optimization Report</h1>
      <div class="subtitle">Multi-Cloud Observability & Governance Audit (AWS · GCP · Azure)</div>
    </div>
    <div style="text-align: right; font-size: 12px; color: #64748b;">
      Generated: ${new Date().toLocaleDateString()}<br>
      System: Node.js v22 Built-in SQLite
    </div>
  </div>

  <div class="grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Spend (Recorded)</div>
      <div class="kpi-value">$${kpis.totalSpend.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Daily Burn Velocity</div>
      <div class="kpi-value">$${kpis.dailyBurnRate.toLocaleString(undefined, {minimumFractionDigits: 2})}/day</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Monthly Budget Status</div>
      <div class="kpi-value">${budget.utilizationPct}% <span style="font-size: 12px; font-weight: normal; color: #64748b;">($${budget.currentSpend.toLocaleString()} / $${budget.budgetAmount.toLocaleString()})</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Monthly Trend (${comparison ? comparison.currentMonth : ''})</div>
      <div class="kpi-value" style="color: ${comparison && comparison.isIncrease ? '#dc2626' : '#16a34a'}">
        ${comparison ? comparison.summaryText : 'N/A'}
      </div>
    </div>
  </div>

  <h3 style="font-size: 14px; margin-bottom: 8px;">Top Cost-Driving Cloud Services</h3>
  <table>
    <thead>
      <tr>
        <th>Service</th>
        <th>Provider</th>
        <th>Category</th>
        <th>Total Incurred Cost</th>
        <th>Avg Daily Cost</th>
      </tr>
    </thead>
    <tbody>
      ${topServices.map(s => `
        <tr>
          <td><strong>${s.service}</strong></td>
          <td><span class="badge badge-${s.provider.toLowerCase()}">${s.provider}</span></td>
          <td>${s.category}</td>
          <td>$${s.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
          <td>$${s.avgCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h3 style="font-size: 14px; margin-bottom: 8px;">Active Spend Anomalies</h3>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Provider & Service</th>
        <th>Deviation</th>
        <th>Actual / Expected</th>
        <th>Root-Cause Diagnostic</th>
      </tr>
    </thead>
    <tbody>
      ${anomalies.slice(0, 5).map(a => `
        <tr>
          <td>${a.date}</td>
          <td>${a.provider} - ${a.service}</td>
          <td><span class="badge badge-alert">+${a.deviation_pct}%</span></td>
          <td>$${a.actual_cost} / $${a.expected_cost}</td>
          <td>${a.root_cause}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h3 style="font-size: 14px; margin-bottom: 8px;">Prioritized Cost Optimization Opportunities</h3>
  <table>
    <thead>
      <tr>
        <th>Recommendation</th>
        <th>Provider</th>
        <th>Category</th>
        <th>Est. Monthly Savings</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${recommendations.map(r => `
        <tr>
          <td><strong>${r.title}</strong><br><span style="color: #64748b; font-size: 11px;">${r.description}</span></td>
          <td>${r.provider}</td>
          <td>${r.category}</td>
          <td style="color: #16a34a; font-weight: 600;">+$${r.monthly_savings.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</td>
          <td>${r.status === 'applied' ? '<span style="color: #16a34a; font-weight: bold;">Applied</span>' : 'Available'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <div>FinOps Cloud Cost Optimization & Analytics Platform &middot; B.Tech Final Year Project</div>
    <div>Confidential Audit Report &middot; Generated via High-Performance Local Engine</div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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
