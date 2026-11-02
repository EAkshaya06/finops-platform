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

      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        updated_at TEXT
      );
    `);

    // Ensure default budget exists for current/recent months if empty
    const budgetCount = this.db.prepare('SELECT COUNT(*) as count FROM budgets').get();
    if (!budgetCount || budgetCount.count === 0) {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7);
      this.setBudget(currentMonth, 65000);
      this.setBudget('global', 65000);
    }
  }

  // --- Billing Records CRUD ---
  insertBillingRecord(rec) {
    const stmt = this.db.prepare(`
      INSERT INTO billing_records (
        date, provider, service, category, region, cost, usage_amount, usage_unit, resource_id, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      rec.date,
      rec.provider,
      rec.service,
      rec.category,
      rec.region,
      Number(Number(rec.cost).toFixed(2)),
      Number(Number(rec.usage_amount || 0).toFixed(2)),
      rec.usage_unit || 'Units',
      rec.resource_id || `res-${Date.now()}`,
      typeof rec.tags === 'object' ? JSON.stringify(rec.tags) : (rec.tags || '{}')
    );
    return result;
  }

  updateBillingRecord(id, rec) {
    const existing = this.db.prepare('SELECT * FROM billing_records WHERE id = ?').get(id);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE billing_records
      SET date = ?, provider = ?, service = ?, category = ?, region = ?, cost = ?, usage_amount = ?, usage_unit = ?, resource_id = ?
      WHERE id = ?
    `);

    stmt.run(
      rec.date || existing.date,
      rec.provider || existing.provider,
      rec.service || existing.service,
      rec.category || existing.category,
      rec.region || existing.region,
      rec.cost !== undefined ? Number(Number(rec.cost).toFixed(2)) : existing.cost,
      rec.usage_amount !== undefined ? Number(Number(rec.usage_amount).toFixed(2)) : existing.usage_amount,
      rec.usage_unit || existing.usage_unit,
      rec.resource_id || existing.resource_id,
      id
    );

    return this.db.prepare('SELECT * FROM billing_records WHERE id = ?').get(id);
  }

  deleteBillingRecord(id) {
    const existing = this.db.prepare('SELECT * FROM billing_records WHERE id = ?').get(id);
    if (!existing) return false;

    this.db.prepare('DELETE FROM billing_records WHERE id = ?').run(id);
    return true;
  }

  getRecordById(id) {
    return this.db.prepare('SELECT * FROM billing_records WHERE id = ?').get(id);
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

  getAvailableMonths() {
    const rows = this.db.prepare(`
      SELECT DISTINCT substr(date, 1, 7) AS month, COUNT(*) as count, ROUND(SUM(cost), 2) as total
      FROM billing_records
      GROUP BY month
      ORDER BY month DESC
    `).all();
    return rows;
  }

  // --- Executive Dashboard KPIs & Monthly Comparison ---
  getKPIs(filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }
    if (filter.provider && filter.provider !== 'all') {
      whereClauses.push('provider = ?');
      params.push(filter.provider);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const totalRow = this.db.prepare(`SELECT SUM(cost) AS totalSpend, COUNT(*) AS count FROM billing_records ${whereSql}`).get(...params);
    const totalSpend = totalRow && totalRow.totalSpend ? Number(totalRow.totalSpend.toFixed(2)) : 0;

    // Daily burn rate
    let dailyBurnRate = 0;
    const maxDateRow = this.db.prepare(`SELECT MAX(date) AS maxDate FROM billing_records ${whereSql}`).get(...params);
    if (maxDateRow && maxDateRow.maxDate) {
      const burnParams = [...params, maxDateRow.maxDate];
      const burnRow = this.db.prepare(`
        SELECT AVG(day_total) AS burnRate
        FROM (
          SELECT date, SUM(cost) AS day_total
          FROM billing_records
          ${whereSql ? whereSql + ' AND' : 'WHERE'} date >= date(?, '-6 day')
          GROUP BY date
        )
      `).get(...burnParams);
      if (burnRow && burnRow.burnRate) {
        dailyBurnRate = Number(burnRow.burnRate.toFixed(2));
      }
    }

    // Real-time Savings Tracker
    const savingsRow = this.db.prepare(`
      SELECT SUM(realized_savings) AS totalSavings
      FROM recommendations
      WHERE status = 'applied'
    `).get();
    const realizedMonthlySavings = savingsRow && savingsRow.totalSavings ? Number(savingsRow.totalSavings.toFixed(2)) : 0;

    // 30-Day Cost Projection
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

    // Monthly Cost Comparison (Current vs Previous Month)
    const monthlyComparison = this.getMonthlyComparison();

    return {
      totalSpend,
      dailyBurnRate,
      projected30DaySpend: net30DayProjection,
      gross30DayProjection: Number(gross30DayProjection.toFixed(2)),
      realizedSavings: realizedMonthlySavings,
      periodGrowthPct: monthlyComparison ? monthlyComparison.percentage : 0,
      monthlyComparison,
      openAnomalies: (anomalyRow && anomalyRow.openCount) || 0,
      resolvedAnomalies: (anomalyRow && anomalyRow.resolvedCount) || 0,
      totalRecommendations: (recRow && recRow.total) || 0,
      appliedRecommendations: (recRow && recRow.appliedCount) || 0,
      totalRecords: totalRow ? totalRow.count : 0,
      activeFilter: filter
    };
  }

  // --- Monthly Cost Comparison ---
  getMonthlyComparison() {
    const rows = this.db.prepare(`
      SELECT substr(date, 1, 7) AS ym, ROUND(SUM(cost), 2) AS total, COUNT(*) as records
      FROM billing_records
      GROUP BY ym
      ORDER BY ym DESC
      LIMIT 2
    `).all();

    if (!rows || rows.length === 0) return null;

    const current = rows[0];
    const previous = rows[1] || { ym: 'Prior Month', total: 0, records: 0 };

    const delta = Number((current.total - previous.total).toFixed(2));
    const percentage = previous.total > 0
      ? Number(((delta / previous.total) * 100).toFixed(1))
      : 0;

    return {
      currentMonth: current.ym,
      currentSpend: current.total,
      previousMonth: previous.ym,
      previousSpend: previous.total,
      delta,
      percentage,
      isIncrease: delta > 0,
      summaryText: delta > 0
        ? `+$${delta.toLocaleString()} (+${percentage}%) vs ${previous.ym}`
        : `-$${Math.abs(delta).toLocaleString()} (${percentage}%) vs ${previous.ym}`
    };
  }

  // --- Budget Management ---
  getBudget(month = 'global') {
    const row = this.db.prepare('SELECT * FROM budgets WHERE month = ?').get(month);
    if (row) return row.amount;

    // Fallback to global
    const globalRow = this.db.prepare("SELECT * FROM budgets WHERE month = 'global'").get();
    return globalRow ? globalRow.amount : 65000;
  }

  setBudget(month, amount) {
    const validAmount = Math.max(0, Number(Number(amount).toFixed(2)));
    const now = new Date().toISOString();

    const existing = this.db.prepare('SELECT * FROM budgets WHERE month = ?').get(month);
    if (existing) {
      this.db.prepare('UPDATE budgets SET amount = ?, updated_at = ? WHERE month = ?').run(validAmount, now, month);
    } else {
      this.db.prepare('INSERT INTO budgets (month, amount, updated_at) VALUES (?, ?, ?)').run(month, validAmount, now);
    }

    return this.getBudgetStatus(month);
  }

  getBudgetStatus(month) {
    const targetMonth = month && month !== 'global' ? month : (this.getLatestMonth() || new Date().toISOString().slice(0, 7));
    const budgetAmount = this.getBudget(targetMonth);

    const spendRow = this.db.prepare(`
      SELECT ROUND(SUM(cost), 2) AS monthSpend
      FROM billing_records
      WHERE substr(date, 1, 7) = ?
    `).get(targetMonth);

    const currentSpend = spendRow && spendRow.monthSpend ? spendRow.monthSpend : 0;
    const remaining = Number((budgetAmount - currentSpend).toFixed(2));
    const utilizationPct = budgetAmount > 0
      ? Number(((currentSpend / budgetAmount) * 100).toFixed(1))
      : 0;

    let alertLevel = 'normal';
    let alertMessage = 'Budget utilization is healthy.';

    if (utilizationPct >= 100) {
      alertLevel = 'critical';
      alertMessage = `Critical: Budget exceeded by $${Math.abs(remaining).toLocaleString(undefined, {minimumFractionDigits: 2})} (${utilizationPct}% utilized)!`;
    } else if (utilizationPct >= 80) {
      alertLevel = 'warning';
      alertMessage = `Warning: High spend alert! Budget is ${utilizationPct}% utilized with $${remaining.toLocaleString(undefined, {minimumFractionDigits: 2})} remaining.`;
    }

    return {
      month: targetMonth,
      budgetAmount,
      currentSpend,
      remainingBalance: remaining,
      utilizationPct,
      alertLevel,
      alertMessage
    };
  }

  getLatestMonth() {
    const row = this.db.prepare("SELECT substr(MAX(date), 1, 7) as latestMonth FROM billing_records").get();
    return row ? row.latestMonth : null;
  }

  // --- Daily Trends with Filters ---
  getDailyTrends(days = 30, filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }

    let whereSql = '';
    if (whereClauses.length > 0) {
      whereSql = 'WHERE ' + whereClauses.join(' AND ');
    } else {
      const maxDateRow = this.db.prepare('SELECT MAX(date) AS maxDate FROM billing_records').get();
      if (!maxDateRow || !maxDateRow.maxDate) return [];
      whereSql = `WHERE date >= date('${maxDateRow.maxDate}', '-${days - 1} day')`;
    }

    const rows = this.db.prepare(`
      SELECT 
        date,
        ROUND(SUM(cost), 2) AS total,
        ROUND(SUM(CASE WHEN provider = 'AWS' THEN cost ELSE 0 END), 2) AS aws,
        ROUND(SUM(CASE WHEN provider = 'GCP' THEN cost ELSE 0 END), 2) AS gcp,
        ROUND(SUM(CASE WHEN provider = 'Azure' THEN cost ELSE 0 END), 2) AS azure
      FROM billing_records
      ${whereSql}
      GROUP BY date
      ORDER BY date ASC
    `).all(...params);

    return rows;
  }

  // --- Provider Spend Split Donut Chart ---
  getProviderBreakdown(filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const rows = this.db.prepare(`
      SELECT 
        provider,
        ROUND(SUM(cost), 2) AS totalCost,
        COUNT(*) AS recordCount
      FROM billing_records
      ${whereSql}
      GROUP BY provider
      ORDER BY totalCost DESC
    `).all(...params);

    const grandTotal = rows.reduce((acc, r) => acc + r.totalCost, 0);

    return rows.map(r => ({
      provider: r.provider,
      totalCost: r.totalCost,
      recordCount: r.recordCount,
      percentage: grandTotal > 0 ? Number(((r.totalCost / grandTotal) * 100).toFixed(1)) : 0
    }));
  }

  // --- Top 5 Costly Services with Search and Sorting ---
  getTopServices(limit = 5, filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }
    if (filter.provider && filter.provider !== 'all') {
      whereClauses.push('provider = ?');
      params.push(filter.provider);
    }
    if (filter.search) {
      whereClauses.push('(service LIKE ? OR provider LIKE ? OR category LIKE ?)');
      const q = `%${filter.search}%`;
      params.push(q, q, q);
    }

    let orderSql = 'totalCost DESC';
    if (filter.sortBy === 'cost_asc') orderSql = 'totalCost ASC';
    else if (filter.sortBy === 'name_asc') orderSql = 'service ASC';
    else if (filter.sortBy === 'name_desc') orderSql = 'service DESC';

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const rows = this.db.prepare(`
      SELECT 
        service,
        provider,
        category,
        ROUND(SUM(cost), 2) AS totalCost,
        ROUND(AVG(cost), 2) AS avgCost,
        COUNT(*) AS recordCount
      FROM billing_records
      ${whereSql}
      GROUP BY service, provider, category
      ORDER BY ${orderSql}
      LIMIT ?
    `).all(...params, limit);

    return rows;
  }

  // --- Category Breakdown ---
  getCategoryBreakdown(filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const rows = this.db.prepare(`
      SELECT 
        category,
        ROUND(SUM(cost), 2) AS totalCost,
        COUNT(*) AS recordCount
      FROM billing_records
      ${whereSql}
      GROUP BY category
      ORDER BY totalCost DESC
    `).all(...params);

    const grandTotal = rows.reduce((acc, r) => acc + r.totalCost, 0);

    return rows.map(r => ({
      category: r.category,
      totalCost: r.totalCost,
      recordCount: r.recordCount,
      percentage: grandTotal > 0 ? Number(((r.totalCost / grandTotal) * 100).toFixed(1)) : 0
    }));
  }

  // --- Savings Calculator Computation ---
  calculateSavings(percentage = 10, month = null) {
    const targetMonth = month || this.getLatestMonth();
    const row = this.db.prepare(`
      SELECT ROUND(SUM(cost), 2) AS spend
      FROM billing_records
      WHERE substr(date, 1, 7) = ?
    `).get(targetMonth);

    const currentMonthlySpend = row && row.spend ? row.spend : 50000;
    const pct = Math.min(100, Math.max(1, Number(percentage) || 10));

    const estimatedMonthlySavings = Number(((currentMonthlySpend * pct) / 100).toFixed(2));
    const estimatedAnnualSavings = Number((estimatedMonthlySavings * 12).toFixed(2));
    const remainingProjectedCost = Number((currentMonthlySpend - estimatedMonthlySavings).toFixed(2));

    return {
      percentage: pct,
      month: targetMonth,
      currentMonthlySpend,
      estimatedMonthlySavings,
      estimatedAnnualSavings,
      remainingProjectedCost
    };
  }

  // --- Paginated Billing Records ---
  getBillingRecords(options = {}) {
    const page = Math.max(1, parseInt(options.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(options.limit) || 10));
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (options.startDate) {
      whereClauses.push('date >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      whereClauses.push('date <= ?');
      params.push(options.endDate);
    }
    if (options.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(options.month);
    }
    if (options.provider && options.provider !== 'all') {
      whereClauses.push('provider = ?');
      params.push(options.provider);
    }
    if (options.category && options.category !== 'all') {
      whereClauses.push('category = ?');
      params.push(options.category);
    }
    if (options.search) {
      whereClauses.push('(service LIKE ? OR resource_id LIKE ? OR region LIKE ?)');
      const q = `%${options.search}%`;
      params.push(q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM billing_records ${whereSql}`).get(...params);
    const total = countRow ? countRow.count : 0;
    const totalPages = Math.ceil(total / limit);

    let orderSql = 'date DESC, id DESC';
    if (options.sortBy === 'cost_desc') orderSql = 'cost DESC';
    else if (options.sortBy === 'cost_asc') orderSql = 'cost ASC';
    else if (options.sortBy === 'date_asc') orderSql = 'date ASC';

    const records = this.db.prepare(`
      SELECT * FROM billing_records
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      records,
      total,
      page,
      limit,
      totalPages
    };
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

  runStatisticalAnomalyDetection() {
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

        if (mean > 20) {
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

  // --- Filtered Export Data ---
  getAllRecords(limit = 20000, filter = {}) {
    let whereClauses = [];
    let params = [];

    if (filter.startDate) {
      whereClauses.push('date >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      whereClauses.push('date <= ?');
      params.push(filter.endDate);
    }
    if (filter.month) {
      whereClauses.push("substr(date, 1, 7) = ?");
      params.push(filter.month);
    }
    if (filter.provider && filter.provider !== 'all') {
      whereClauses.push('provider = ?');
      params.push(filter.provider);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    return this.db.prepare(`SELECT * FROM billing_records ${whereSql} ORDER BY date DESC LIMIT ?`).all(...params, limit);
  }
}

module.exports = { FinOpsDB };
