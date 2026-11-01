const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'costs.db');

class FinOpsDB {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS billing_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        provider TEXT NOT NULL,
        service TEXT NOT NULL,
        category TEXT NOT NULL,
        region TEXT NOT NULL,
        cost REAL NOT NULL,
        usage_amount REAL NOT NULL,
        usage_unit TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        tags TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_billing_date ON billing_records(date);
      CREATE INDEX IF NOT EXISTS idx_billing_provider ON billing_records(provider);
      CREATE INDEX IF NOT EXISTS idx_billing_service ON billing_records(service);
      CREATE INDEX IF NOT EXISTS idx_billing_category ON billing_records(category);

      CREATE TABLE IF NOT EXISTS anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        provider TEXT NOT NULL,
        service TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        actual_cost REAL NOT NULL,
        expected_cost REAL NOT NULL,
        deviation_pct REAL NOT NULL,
        root_cause TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomalies(status);

      CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        impact TEXT NOT NULL,
        monthly_savings REAL NOT NULL,
        effort TEXT NOT NULL DEFAULT 'Low',
        status TEXT NOT NULL DEFAULT 'available',
        applied_at TEXT,
        realized_savings REAL DEFAULT 0
      );
    `);
  }

  // --- Billing Records ---
  insertBillingRecord(rec) {
    const stmt = this.db.prepare(`
      INSERT INTO billing_records (
        date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      rec.date,
      rec.provider,
      rec.service,
      rec.category,
      rec.region,
      Number(rec.cost.toFixed(2)),
      Number(rec.usage_amount.toFixed(2)),
      rec.usage_unit,
      rec.resource_id,
      typeof rec.tags === 'object' ? JSON.stringify(rec.tags) : (rec.tags || '{}')
    );
  }

  insertBulkRecords(records) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const stmt = this.db.prepare(`
        INSERT INTO billing_records (
          date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rec of records) {
        stmt.run(
          rec.date,
          rec.provider,
          rec.service,
          rec.category,
          rec.region,
          Number(rec.cost.toFixed(2)),
          Number(rec.usage_amount.toFixed(2)),
          rec.usage_unit,
          rec.resource_id,
          typeof rec.tags === 'object' ? JSON.stringify(rec.tags) : (rec.tags || '{}')
        );
      }
      this.db.exec('COMMIT;');
      return records.length;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  getRecordCount() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM billing_records').get();
    return row ? row.count : 0;
  }

  getDateRange() {
    const row = this.db.prepare('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM billing_records').get();
    return {
      minDate: row ? row.minDate : null,
      maxDate: row ? row.maxDate : null
    };
  }

  // --- Executive Dashboard KPIs ---
  getKPIs() {
    const totalRow = this.db.prepare('SELECT SUM(cost) AS totalSpend, COUNT(*) AS count FROM billing_records').get();
    const totalSpend = totalRow && totalRow.totalSpend ? Number(totalRow.totalSpend.toFixed(2)) : 0;

    // Daily burn rate calculated across last 7 days of recorded data
    const maxDateRow = this.db.prepare('SELECT MAX(date) AS maxDate FROM billing_records').get();
    let dailyBurnRate = 0;
    if (maxDateRow && maxDateRow.maxDate) {
      const burnRow = this.db.prepare(`
        SELECT AVG(day_total) AS burnRate
        FROM (
          SELECT date, SUM(cost) AS day_total
          FROM billing_records
          WHERE date >= date(?, '-6 day')
          GROUP BY date
        )
      `).get(maxDateRow.maxDate);
      if (burnRow && burnRow.burnRate) {
        dailyBurnRate = Number(burnRow.burnRate.toFixed(2));
      }
    }

    // Real-Time Savings Tracker (Sum of realized monthly savings from applied recommendations)
    const savingsRow = this.db.prepare(`
      SELECT SUM(realized_savings) AS totalSavings
      FROM recommendations
      WHERE status = 'applied'
    `).get();
    const realizedMonthlySavings = savingsRow && savingsRow.totalSavings ? Number(savingsRow.totalSavings.toFixed(2)) : 0;

    // 30-Day Cost Projection: (Daily Burn * 30) minus realized monthly savings deduction
    const gross30DayProjection = dailyBurnRate * 30;
    const net30DayProjection = Math.max(0, Number((gross30DayProjection - realizedMonthlySavings).toFixed(2)));

    // Anomaly counts
    const anomalyRow = this.db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS openCount,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolvedCount
      FROM anomalies
    `).get();

    // Recommendation counts
    const recRow = this.db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS appliedCount
      FROM recommendations
    `).get();

    // Previous 30-day period vs latest 30-day period comparison for trend badge
    let periodGrowthPct = 0;
    if (maxDateRow && maxDateRow.maxDate) {
      const recent30 = this.db.prepare(`
        SELECT SUM(cost) AS spend
        FROM billing_records
        WHERE date >= date(?, '-29 day')
      `).get(maxDateRow.maxDate);

      const prior30 = this.db.prepare(`
        SELECT SUM(cost) AS spend
        FROM billing_records
        WHERE date >= date(?, '-59 day') AND date < date(?, '-29 day')
      `).get(maxDateRow.maxDate, maxDateRow.maxDate);

      const recentSpend = (recent30 && recent30.spend) || 0;
      const priorSpend = (prior30 && prior30.spend) || 0;
      if (priorSpend > 0) {
        periodGrowthPct = Number((((recentSpend - priorSpend) / priorSpend) * 100).toFixed(1));
      }
    }

    return {
      totalSpend,
      dailyBurnRate,
      projected30DaySpend: net30DayProjection,
      gross30DayProjection: Number(gross30DayProjection.toFixed(2)),
      realizedSavings: realizedMonthlySavings,
      periodGrowthPct,
      openAnomalies: (anomalyRow && anomalyRow.openCount) || 0,
      resolvedAnomalies: (anomalyRow && anomalyRow.resolvedCount) || 0,
      totalRecommendations: (recRow && recRow.total) || 0,
      appliedRecommendations: (recRow && recRow.appliedCount) || 0,
      totalRecords: totalRow ? totalRow.count : 0
    };
  }

  // --- Daily Trends for Area Chart ---
  getDailyTrends(days = 30) {
    const maxDateRow = this.db.prepare('SELECT MAX(date) AS maxDate FROM billing_records').get();
    if (!maxDateRow || !maxDateRow.maxDate) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT 
        date,
        ROUND(SUM(cost), 2) AS total,
        ROUND(SUM(CASE WHEN provider = 'AWS' THEN cost ELSE 0 END), 2) AS aws,
        ROUND(SUM(CASE WHEN provider = 'GCP' THEN cost ELSE 0 END), 2) AS gcp,
        ROUND(SUM(CASE WHEN provider = 'Azure' THEN cost ELSE 0 END), 2) AS azure
      FROM billing_records
      WHERE date >= date(?, '-' || ? || ' day')
      GROUP BY date
      ORDER BY date ASC
    `).all(maxDateRow.maxDate, (days - 1).toString());

    return rows;
  }

  // --- Provider Spend Split Donut Chart ---
  getProviderBreakdown() {
    const rows = this.db.prepare(`
      SELECT 
        provider,
        ROUND(SUM(cost), 2) AS totalCost,
        COUNT(*) AS recordCount
      FROM billing_records
      GROUP BY provider
      ORDER BY totalCost DESC
    `).all();

    const grandTotal = rows.reduce((acc, r) => acc + r.totalCost, 0);

    return rows.map(r => ({
      provider: r.provider,
      totalCost: r.totalCost,
      recordCount: r.recordCount,
      percentage: grandTotal > 0 ? Number(((r.totalCost / grandTotal) * 100).toFixed(1)) : 0
    }));
  }

  // --- Top 6 Cost-Driving Services Bar Chart ---
  getTopServices(limit = 6) {
    const rows = this.db.prepare(`
      SELECT 
        service,
        provider,
        category,
        ROUND(SUM(cost), 2) AS totalCost
      FROM billing_records
      GROUP BY service, provider, category
      ORDER BY totalCost DESC
      LIMIT ?
    `).all(limit);

    return rows;
  }

  // --- Category Progress Bars ---
  getCategoryBreakdown() {
    const rows = this.db.prepare(`
      SELECT 
        category,
        ROUND(SUM(cost), 2) AS totalCost,
        COUNT(*) AS recordCount
      FROM billing_records
      GROUP BY category
      ORDER BY totalCost DESC
    `).all();

    const grandTotal = rows.reduce((acc, r) => acc + r.totalCost, 0);

    return rows.map(r => ({
      category: r.category,
      totalCost: r.totalCost,
      recordCount: r.recordCount,
      percentage: grandTotal > 0 ? Number(((r.totalCost / grandTotal) * 100).toFixed(1)) : 0
    }));
  }

  // --- Anomalies Detection & Management ---
  getAnomalies(statusFilter = 'all') {
    let sql = 'SELECT * FROM anomalies';
    if (statusFilter === 'open' || statusFilter === 'resolved') {
      sql += ' WHERE status = ?';
      return this.db.prepare(sql + ' ORDER BY date DESC, deviation_pct DESC').all(statusFilter);
    }
    return this.db.prepare(sql + ' ORDER BY date DESC, deviation_pct DESC').all();
  }

  toggleAnomalyStatus(id) {
    const anomaly = this.db.prepare('SELECT * FROM anomalies WHERE id = ?').get(id);
    if (!anomaly) return null;

    const newStatus = anomaly.status === 'open' ? 'resolved' : 'open';
    const resolvedAt = newStatus === 'resolved' ? new Date().toISOString() : null;

    this.db.prepare(`
      UPDATE anomalies 
      SET status = ?, resolved_at = ?
      WHERE id = ?
    `).run(newStatus, resolvedAt, id);

    return this.db.prepare('SELECT * FROM anomalies WHERE id = ?').get(id);
  }

  insertAnomaly(anom) {
    const stmt = this.db.prepare(`
      INSERT INTO anomalies (
        date, provider, service, resource_id, actual_cost, expected_cost, deviation_pct, root_cause, status, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      anom.date,
      anom.provider,
      anom.service,
      anom.resource_id,
      Number(anom.actual_cost.toFixed(2)),
      Number(anom.expected_cost.toFixed(2)),
      Number(anom.deviation_pct.toFixed(1)),
      anom.root_cause,
      anom.status || 'open',
      anom.resolved_at || null
    );
  }

  // Statistical deviation detection (>30% variance from 14-day rolling mean)
  runStatisticalAnomalyDetection() {
    // Computes daily spend by service and flags days where actual cost exceeds rolling 14-day mean by >30%
    const serviceDays = this.db.prepare(`
      SELECT 
        date,
        provider,
        service,
        ROUND(SUM(cost), 2) AS daily_cost,
        GROUP_CONCAT(resource_id) AS resources
      FROM billing_records
      GROUP BY date, provider, service
      ORDER BY service, date ASC
    `).all();

    // Group by service
    const byService = {};
    for (const row of serviceDays) {
      if (!byService[row.service]) byService[row.service] = [];
      byService[row.service].push(row);
    }

    const detected = [];
    for (const service in byService) {
      const records = byService[service];
      for (let i = 14; i < records.length; i++) {
        const window = records.slice(i - 14, i);
        const mean = window.reduce((sum, r) => sum + r.daily_cost, 0) / 14;
        const current = records[i];

        if (mean > 20) { // filter out negligible absolute fluctuations
          const deviation = ((current.daily_cost - mean) / mean) * 100;
          if (deviation > 30) {
            detected.push({
              date: current.date,
              provider: current.provider,
              service: current.service,
              resource_id: current.resources.split(',')[0] || `${current.service.toLowerCase().replace(/\s+/g, '-')}-worker`,
              actual_cost: current.daily_cost,
              expected_cost: Number(mean.toFixed(2)),
              deviation_pct: Number(deviation.toFixed(1)),
              root_cause: `Statistical spike: ${current.service} spend exceeded 14-day baseline ($${mean.toFixed(2)}/day) by +${deviation.toFixed(1)}%.`
            });
          }
        }
      }
    }
    return detected;
  }

  // --- Recommendations ---
  getRecommendations() {
    return this.db.prepare('SELECT * FROM recommendations ORDER BY monthly_savings DESC').all();
  }

  applyRecommendation(id) {
    const rec = this.db.prepare('SELECT * FROM recommendations WHERE id = ?').get(id);
    if (!rec) return null;

    const newStatus = rec.status === 'available' ? 'applied' : 'available';
    const appliedAt = newStatus === 'applied' ? new Date().toISOString() : null;
    const realizedSavings = newStatus === 'applied' ? rec.monthly_savings : 0;

    this.db.prepare(`
      UPDATE recommendations
      SET status = ?, applied_at = ?, realized_savings = ?
      WHERE id = ?
    `).run(newStatus, appliedAt, realizedSavings, id);

    return this.db.prepare('SELECT * FROM recommendations WHERE id = ?').get(id);
  }

  insertRecommendation(rec) {
    const stmt = this.db.prepare(`
      INSERT INTO recommendations (
        title, provider, category, description, impact, monthly_savings, effort, status, applied_at, realized_savings
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      rec.title,
      rec.provider,
      rec.category,
      rec.description,
      rec.impact,
      rec.monthly_savings,
      rec.effort || 'Medium',
      rec.status || 'available',
      rec.applied_at || null,
      rec.realized_savings || 0
    );
  }

  // --- Export Data ---
  getAllRecords(limit = 10000) {
    return this.db.prepare('SELECT * FROM billing_records ORDER BY date DESC LIMIT ?').all(limit);
  }
}

module.exports = { FinOpsDB };
