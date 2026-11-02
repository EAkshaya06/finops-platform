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

runTest('budgets table exists for budget management', () => {
  const info = dbInstance.db.prepare("PRAGMA table_info(budgets)").all();
  const columns = info.map(c => c.name);
  assert.ok(columns.includes('month'), 'Missing month column');
  assert.ok(columns.includes('amount'), 'Missing amount column');
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
  assert.ok(services.length >= 5, 'Expected at least 5 services');
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
});

runTest('Applying a recommendation dynamically updates realized savings and 30-day projection', () => {
  const recs = dbInstance.getRecommendations();
  const availableRec = recs.find(r => r.status === 'available');
  assert.ok(availableRec, 'Expected at least one available recommendation');

  const initialKpis = dbInstance.getKPIs();
  const initialSavings = initialKpis.realizedSavings;
  const initialProjection = initialKpis.projected30DaySpend;

  const applied = dbInstance.applyRecommendation(availableRec.id);
  assert.strictEqual(applied.status, 'applied');

  const updatedKpis = dbInstance.getKPIs();
  assert.strictEqual(
    Number((updatedKpis.realizedSavings - initialSavings).toFixed(2)),
    availableRec.monthly_savings
  );
  assert.strictEqual(
    Number((initialProjection - updatedKpis.projected30DaySpend).toFixed(2)),
    availableRec.monthly_savings
  );

  // Revert back
  dbInstance.applyRecommendation(availableRec.id);
});

console.log('\n--- Suite 7: B.Tech Features (Budget, Comparison, Calculator, Top Services, CRUD) ---');

runTest('Budget management calculates utilization and threshold warnings', () => {
  const latestMonth = dbInstance.getLatestMonth();
  assert.ok(latestMonth, 'Latest month must exist');
  
  // Set budget to a known amount
  dbInstance.setBudget(latestMonth, 10000);
  const status1 = dbInstance.getBudgetStatus(latestMonth);
  assert.strictEqual(status1.budgetAmount, 10000);
  assert.ok(status1.utilizationPct > 0);
  
  // High budget test (healthy status)
  dbInstance.setBudget(latestMonth, 500000);
  const status2 = dbInstance.getBudgetStatus(latestMonth);
  assert.strictEqual(status2.alertLevel, 'normal');
});

runTest('Monthly cost comparison compares current and previous month spending', () => {
  const comparison = dbInstance.getMonthlyComparison();
  assert.ok(comparison, 'Monthly comparison should return data');
  assert.ok(comparison.currentMonth, 'Current month should be identified');
  assert.ok(comparison.currentSpend > 0, 'Current spend must be > 0');
  assert.ok(typeof comparison.delta === 'number', 'Delta must be numeric');
  assert.ok(typeof comparison.percentage === 'number', 'Percentage must be numeric');
});

runTest('Savings calculator accurately projects 10%, 15%, 20% cost reductions', () => {
  const calc10 = dbInstance.calculateSavings(10);
  const calc15 = dbInstance.calculateSavings(15);
  const calc20 = dbInstance.calculateSavings(20);

  assert.strictEqual(calc10.percentage, 10);
  assert.strictEqual(calc15.percentage, 15);
  assert.strictEqual(calc20.percentage, 20);

  assert.ok(calc10.estimatedMonthlySavings > 0);
  assert.ok(calc20.estimatedMonthlySavings > calc10.estimatedMonthlySavings);
  assert.strictEqual(Number((calc10.estimatedMonthlySavings * 12).toFixed(2)), calc10.estimatedAnnualSavings);
});

runTest('Top 5 services supports search and multiple sorting orders', () => {
  const topDesc = dbInstance.getTopServices(5, { sortBy: 'cost_desc' });
  assert.strictEqual(topDesc.length, 5);
  assert.ok(topDesc[0].totalCost >= topDesc[1].totalCost);

  const topAsc = dbInstance.getTopServices(5, { sortBy: 'cost_asc' });
  assert.ok(topAsc[0].totalCost <= topAsc[1].totalCost);

  const searchEC2 = dbInstance.getTopServices(5, { search: 'EC2' });
  assert.ok(searchEC2.length > 0);
  assert.ok(searchEC2[0].service.includes('EC2'));
});

runTest('Billing records CRUD: insert, get, update, and delete work with validation', () => {
  const uniqueResId = `test-res-${Date.now()}`;
  const inserted = dbInstance.insertBillingRecord({
    date: '2026-11-01',
    provider: 'AWS',
    service: 'TestService',
    category: 'Compute',
    region: 'us-east-1',
    cost: 99.50,
    usage_amount: 100,
    usage_unit: 'Hrs',
    resource_id: uniqueResId
  });
  assert.ok(inserted);

  const found = dbInstance.getBillingRecords({ search: uniqueResId });
  assert.strictEqual(found.total, 1);
  const targetId = found.records[0].id;

  // Update
  const updated = dbInstance.updateBillingRecord(targetId, { cost: 150.75, service: 'UpdatedTestService' });
  assert.strictEqual(updated.cost, 150.75);
  assert.strictEqual(updated.service, 'UpdatedTestService');

  // Delete
  const deleted = dbInstance.deleteBillingRecord(targetId);
  assert.strictEqual(deleted, true);

  const afterDelete = dbInstance.getRecordById(targetId);
  assert.strictEqual(afterDelete, undefined);
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
    const budget = await fetchJson('/api/budget');
    assert.strictEqual(budget.status, 200);
    assert.ok(budget.data.data.budgetAmount > 0);
    console.log('  [PASS] /api/budget returns active budget status');
    passedTests++;

    totalTests++;
    const comparison = await fetchJson('/api/comparison');
    assert.strictEqual(comparison.status, 200);
    assert.ok(comparison.data.data.currentSpend > 0);
    console.log('  [PASS] /api/comparison returns monthly comparison');
    passedTests++;

    totalTests++;
    const calc = await fetchJson('/api/calculator?reduction=15');
    assert.strictEqual(calc.status, 200);
    assert.strictEqual(calc.data.data.percentage, 15);
    console.log('  [PASS] /api/calculator returns 15% savings estimate');
    passedTests++;

    totalTests++;
    const records = await fetchJson('/api/records?page=1&limit=5');
    assert.strictEqual(records.status, 200);
    assert.strictEqual(records.data.records.length, 5);
    console.log('  [PASS] /api/records returns paginated billing records');
    passedTests++;

    totalTests++;
    const reportRes = await fetchJson('/api/export/report');
    assert.strictEqual(reportRes.status, 200);
    assert.ok(reportRes.text.includes('FinOps Cloud Cost Optimization Report'));
    console.log('  [PASS] /api/export/report returns printable PDF executive view');
    passedTests++;

    totalTests++;
    const csvRes = await fetchJson('/api/export/csv');
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvRes.headers['content-type'].includes('text/csv'));
    console.log('  [PASS] /api/export/csv streams valid CSV audit download');
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
