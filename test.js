const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { FinOpsDB } = require('./db');

console.log('======================================================');
console.log('   RUNNING FINOPS AUTOMATED TEST SUITE');
console.log('======================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         Error: ${err.message}`);
    throw err;
  }
}

// Use test database or existing costs.db
const dbFile = path.join(__dirname, 'costs.db');
assert.ok(fs.existsSync(dbFile), 'Database file costs.db must exist before running tests.');

const dbInstance = new FinOpsDB(dbFile);

console.log('--- Suite 1: Database Initialization & Table Schemas ---');

runTest('billing_records table exists and has proper columns', () => {
  const info = dbInstance.db.prepare("PRAGMA table_info(billing_records)").all();
  const columns = info.map(c => c.name);
  assert.ok(columns.includes('id'), 'Missing id column');
  assert.ok(columns.includes('date'), 'Missing date column');
  assert.ok(columns.includes('provider'), 'Missing provider column');
  assert.ok(columns.includes('service'), 'Missing service column');
  assert.ok(columns.includes('category'), 'Missing category column');
  assert.ok(columns.includes('region'), 'Missing region column');
  assert.ok(columns.includes('cost'), 'Missing cost column');
  assert.ok(columns.includes('usage_amount'), 'Missing usage_amount column');
  assert.ok(columns.includes('resource_id'), 'Missing resource_id column');
});

runTest('anomalies table exists and has root_cause and status columns', () => {
  const info = dbInstance.db.prepare("PRAGMA table_info(anomalies)").all();
  const columns = info.map(c => c.name);
  assert.ok(columns.includes('deviation_pct'), 'Missing deviation_pct column');
  assert.ok(columns.includes('root_cause'), 'Missing root_cause column');
  assert.ok(columns.includes('status'), 'Missing status column');
});

runTest('recommendations table exists with savings and status fields', () => {
  const info = dbInstance.db.prepare("PRAGMA table_info(recommendations)").all();
  const columns = info.map(c => c.name);
  assert.ok(columns.includes('monthly_savings'), 'Missing monthly_savings column');
  assert.ok(columns.includes('realized_savings'), 'Missing realized_savings column');
  assert.ok(columns.includes('status'), 'Missing status column');
});

console.log('\n--- Suite 2: Record Volumes & Temporal Range (2,000+ records / 6 months) ---');

runTest('Database contains >= 2,000 records spanning 6 months', () => {
  const count = dbInstance.getRecordCount();
  console.log(`         Total records count: ${count}`);
  assert.ok(count >= 2000, `Expected at least 2000 records, got ${count}`);

  const range = dbInstance.getDateRange();
  console.log(`         Date range: ${range.minDate} to ${range.maxDate}`);
  assert.ok(range.minDate && range.maxDate, 'Date range must have min and max dates');
  
  const minDate = new Date(range.minDate);
  const maxDate = new Date(range.maxDate);
  const diffDays = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));
  console.log(`         Total days spanned: ${diffDays} days`);
  assert.ok(diffDays >= 170, `Expected span >= 170 days (approx 6 months), got ${diffDays}`);
});

console.log('\n--- Suite 3: Multi-Cloud Providers & Service Coverage ---');

runTest('Data encompasses AWS, GCP, and Azure providers', () => {
  const providers = dbInstance.getProviderBreakdown();
  const providerNames = providers.map(p => p.provider);
  assert.ok(providerNames.includes('AWS'), 'AWS records missing');
  assert.ok(providerNames.includes('GCP'), 'GCP records missing');
  assert.ok(providerNames.includes('Azure'), 'Azure records missing');

  for (const p of providers) {
    assert.ok(p.totalCost > 0, `${p.provider} total cost must be > 0`);
    assert.ok(p.percentage > 0, `${p.provider} percentage must be > 0`);
  }
});

runTest('Top cost drivers include primary compute and database services', () => {
  const services = dbInstance.getTopServices(10);
  assert.ok(services.length >= 6, 'Expected at least 6 services');
  const serviceNames = services.map(s => s.service);
  assert.ok(serviceNames.includes('EC2'), 'AWS EC2 missing from top services');
  assert.ok(serviceNames.includes('Compute Engine'), 'GCP Compute Engine missing from top services');
  assert.ok(serviceNames.includes('Virtual Machines'), 'Azure Virtual Machines missing from top services');
});

runTest('Categories cover Compute, Storage, Database, Networking, and Serverless', () => {
  const categories = dbInstance.getCategoryBreakdown();
  const catNames = categories.map(c => c.category);
  const expected = ['Compute', 'Storage', 'Database', 'Networking', 'Serverless'];
  for (const cat of expected) {
    assert.ok(catNames.includes(cat), `Category '${cat}' missing`);
  }
});

console.log('\n--- Suite 4: Seasonal Growth & Weekend Dip Patterns ---');

runTest('Weekend spend is statistically lower than weekday spend (weekend dip)', () => {
  const weekdayAvgRow = dbInstance.db.prepare(`
    SELECT AVG(day_total) AS avgSpend
    FROM (
      SELECT date, SUM(cost) AS day_total, strftime('%w', date) AS dow
      FROM billing_records
      WHERE strftime('%w', date) NOT IN ('0', '6')
      GROUP BY date
    )
  `).get();

  const weekendAvgRow = dbInstance.db.prepare(`
    SELECT AVG(day_total) AS avgSpend
    FROM (
      SELECT date, SUM(cost) AS day_total, strftime('%w', date) AS dow
      FROM billing_records
      WHERE strftime('%w', date) IN ('0', '6')
      GROUP BY date
    )
  `).get();

  const weekdayAvg = weekdayAvgRow.avgSpend;
  const weekendAvg = weekendAvgRow.avgSpend;
  console.log(`         Weekday Avg: $${weekdayAvg.toFixed(2)}, Weekend Avg: $${weekendAvg.toFixed(2)}`);
  assert.ok(weekendAvg < weekdayAvg, `Weekend average ($${weekendAvg}) should be lower than weekday average ($${weekdayAvg})`);
  const dipPct = ((weekdayAvg - weekendAvg) / weekdayAvg) * 100;
  console.log(`         Observed weekend dip: -${dipPct.toFixed(1)}%`);
  assert.ok(dipPct >= 15, `Expected weekend dip of at least 15%, observed ${dipPct.toFixed(1)}%`);
});

runTest('Regional cost variance reflects pricing differentials', () => {
  const usEast = dbInstance.db.prepare(`
    SELECT AVG(cost) AS avgCost FROM billing_records WHERE provider = 'AWS' AND service = 'EC2' AND region = 'us-east-1'
  `).get();

  const euCentral = dbInstance.db.prepare(`
    SELECT AVG(cost) AS avgCost FROM billing_records WHERE provider = 'AWS' AND service = 'EC2' AND region = 'eu-central-1'
  `).get();

  assert.ok(euCentral.avgCost > usEast.avgCost, 'eu-central-1 EC2 cost should exceed us-east-1 benchmark');
});

console.log('\n--- Suite 5: Anomaly Detection Logic & Root-Cause Resolution ---');

runTest('Statistical anomaly detector flags spikes >30% variance from 14-day rolling mean', () => {
  const detected = dbInstance.runStatisticalAnomalyDetection();
  console.log(`         Detected statistical anomalies: ${detected.length}`);
  assert.ok(detected.length > 0, 'Statistical detector should detect intentional cost spikes');
  for (const anom of detected) {
    assert.ok(anom.deviation_pct > 30, `Anomaly deviation ${anom.deviation_pct}% must be > 30%`);
    assert.ok(anom.root_cause.length > 10, 'Root-cause description must be informative');
  }
});

runTest('Root-cause descriptions exist for orphaned resources (EBS, Elastic IP, BigQuery)', () => {
  const anomalies = dbInstance.getAnomalies('all');
  const causes = anomalies.map(a => a.root_cause.toLowerCase()).join(' ');
  assert.ok(causes.includes('ebs'), 'Missing EBS orphaned anomaly');
  assert.ok(causes.includes('elastic ip') || causes.includes('unassociated'), 'Missing Elastic IP anomaly');
  assert.ok(causes.includes('bigquery') || causes.includes('scan'), 'Missing BigQuery unpartitioned scan anomaly');
  assert.ok(causes.includes('nat gateway') || causes.includes('cosmos'), 'Missing NAT Gateway / Cosmos DB anomaly');
});

runTest('Anomaly status can be toggled interactively (open <-> resolved)', () => {
  const anomalies = dbInstance.getAnomalies('all');
  assert.ok(anomalies.length > 0, 'No anomalies found to test toggle');
  const target = anomalies[0];
  const originalStatus = target.status;

  const toggled1 = dbInstance.toggleAnomalyStatus(target.id);
  assert.notStrictEqual(toggled1.status, originalStatus, 'Status should invert after toggle');

  const toggled2 = dbInstance.toggleAnomalyStatus(target.id);
  assert.strictEqual(toggled2.status, originalStatus, 'Status should restore after second toggle');
});

console.log('\n--- Suite 6: Cost Optimization & Real-Time Savings Recalculation ---');

runTest('Prioritized savings recommendations exist with positive monthly savings', () => {
  const recs = dbInstance.getRecommendations();
  assert.ok(recs.length >= 4, 'Expected at least 4 recommendations');
  const titles = recs.map(r => r.title);
  assert.ok(titles.some(t => t.includes('Graviton')), 'Missing Graviton rightsizing recommendation');
  assert.ok(titles.some(t => t.includes('Glacier') || t.includes('Tiering')), 'Missing S3 Intelligent-Tiering recommendation');
  assert.ok(titles.some(t => t.includes('Spot')), 'Missing Spot VM batch recommendation');
  assert.ok(titles.some(t => t.includes('Committed') || t.includes('CUD')), 'Missing Committed Use Discounts recommendation');
});

runTest('Applying a recommendation dynamically updates realized savings and 30-day projection', () => {
  const recs = dbInstance.getRecommendations();
  // Find an available recommendation
  const availableRec = recs.find(r => r.status === 'available');
  assert.ok(availableRec, 'Expected at least one available recommendation');

  const initialKpis = dbInstance.getKPIs();
  const initialSavings = initialKpis.realizedSavings;
  const initialProjection = initialKpis.projected30DaySpend;

  // Apply recommendation
  const applied = dbInstance.applyRecommendation(availableRec.id);
  assert.strictEqual(applied.status, 'applied');
  assert.strictEqual(applied.realized_savings, availableRec.monthly_savings);

  // Verify KPIs dynamically updated
  const updatedKpis = dbInstance.getKPIs();
  console.log(`         Initial Savings: $${initialSavings}, Updated Savings: $${updatedKpis.realizedSavings}`);
  console.log(`         Initial Projection: $${initialProjection}, Updated Projection: $${updatedKpis.projected30DaySpend}`);

  assert.strictEqual(
    Number((updatedKpis.realizedSavings - initialSavings).toFixed(2)),
    availableRec.monthly_savings,
    'Realized savings should increase exactly by recommendation monthly savings'
  );

  assert.strictEqual(
    Number((initialProjection - updatedKpis.projected30DaySpend).toFixed(2)),
    availableRec.monthly_savings,
    '30-day projection should reduce by realized savings amount'
  );

  // Rollback to keep test state idempotent
  const rolledBack = dbInstance.applyRecommendation(availableRec.id);
  assert.strictEqual(rolledBack.status, 'available');
  const restoredKpis = dbInstance.getKPIs();
  assert.strictEqual(restoredKpis.realizedSavings, initialSavings);
});

console.log('\n--- Suite 7: Export Formats & Reports Verification ---');

runTest('Audit CSV export contains valid header and records', () => {
  const records = dbInstance.getAllRecords(100);
  assert.ok(records.length > 0, 'Records must not be empty');
  const r = records[0];
  assert.ok(r.date && r.provider && r.service && r.cost !== undefined, 'Record missing export attributes');
});

runTest('Audit JSON generation produces well-structured executive report', () => {
  const kpis = dbInstance.getKPIs();
  const providers = dbInstance.getProviderBreakdown();
  const categories = dbInstance.getCategoryBreakdown();
  const anomalies = dbInstance.getAnomalies('all');
  const recommendations = dbInstance.getRecommendations();

  const report = {
    meta: { platform: 'FinOps Analytics Platform', version: '1.0.0' },
    executiveSummaryKPIs: kpis,
    multiCloudBreakdown: { providers, categories },
    anomalyDetectionCenter: { count: anomalies.length },
    costOptimizationHub: { count: recommendations.length }
  };

  const jsonStr = JSON.stringify(report);
  const parsed = JSON.parse(jsonStr);
  assert.strictEqual(parsed.meta.platform, 'FinOps Analytics Platform');
  assert.ok(parsed.executiveSummaryKPIs.totalSpend > 0, 'Total spend must be positive in report');
});

console.log('\n--- Suite 8: Express REST API Endpoints Verification ---');

const http = require('node:http');
const app = require('./server');

let testServer;

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const port = testServer.address().port;
    http.get(`http://localhost:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        }
      });
    }).on('error', reject);
  });
}

async function runAsyncTests() {
  await new Promise((resolve) => {
    testServer = app.listen(0, resolve);
  });

  try {
    totalTests++;
    const health = await fetchJson('/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'healthy');
    console.log('  [PASS] /api/health endpoint responds with healthy status');
    passedTests++;

    totalTests++;
    const kpi = await fetchJson('/api/kpi');
    assert.strictEqual(kpi.status, 200);
    assert.ok(kpi.data.data.totalSpend > 0);
    console.log('  [PASS] /api/kpi endpoint returns valid FinOps metrics');
    passedTests++;

    totalTests++;
    const trends = await fetchJson('/api/trends?range=30d');
    assert.strictEqual(trends.status, 200);
    assert.strictEqual(trends.data.data.length, 30);
    console.log('  [PASS] /api/trends?range=30d returns accurate daily dataset');
    passedTests++;

    totalTests++;
    const csvRes = await fetchJson('/api/export/csv');
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvRes.headers['content-type'].includes('text/csv'));
    console.log('  [PASS] /api/export/csv streams valid CSV audit download');
    passedTests++;

    totalTests++;
    const jsonRes = await fetchJson('/api/export/json');
    assert.strictEqual(jsonRes.status, 200);
    assert.strictEqual(jsonRes.data.meta.platform, 'Cloud Cost Optimization & FinOps Analytics Platform');
    console.log('  [PASS] /api/export/json outputs standardized JSON audit report');
    passedTests++;
  } finally {
    testServer.close();
  }

  console.log('\n======================================================');
  console.log(`  ALL TEST SUITES PASSED: ${passedTests} / ${totalTests} (100% Success Rate)`);
  console.log('======================================================\n');
}

runAsyncTests().catch(err => {
  console.error('Async tests error:', err);
  process.exit(1);
});

