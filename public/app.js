// FinOps Executive Dashboard Client Application
document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let selectedMonth = 'all';
  let selectedProvider = 'all';
  let filterStartDate = '';
  let filterEndDate = '';
  let currentTrendRange = '180d';
  let currentAnomalyFilter = 'all';
  let recordsPage = 1;
  let recordsSearch = '';
  let topServicesSearch = '';
  let topServicesSort = 'cost_desc';
  let currentSavingsPct = 10;
  let pendingDeleteRecordId = null;

  let trendChartInstance = null;
  let providerDonutInstance = null;

  // Initialize Lucide icons
  const refreshIcons = () => {
    if (window.lucide) window.lucide.createIcons();
  };
  refreshIcons();

  // Currency & Number Formatters
  const formatUSD = (val) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val || 0);
  };

  const formatCompactUSD = (val) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return formatUSD(val);
  };

  // Toast Notification System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center space-x-2 px-4 py-3 rounded-xl border shadow-xl text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 ${
      type === 'success'
        ? 'bg-slate-900/95 border-emerald-500/40 text-emerald-300 shadow-emerald-950/40'
        : type === 'warning'
        ? 'bg-slate-900/95 border-amber-500/40 text-amber-300 shadow-amber-950/40'
        : type === 'danger'
        ? 'bg-slate-900/95 border-rose-500/40 text-rose-300 shadow-rose-950/40'
        : 'bg-slate-900/95 border-blue-500/40 text-blue-300 shadow-blue-950/40'
    }`;

    const icon = type === 'success' ? 'check-circle' : (type === 'warning' || type === 'danger' ? 'alert-triangle' : 'info');
    toast.innerHTML = `
      <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    refreshIcons();

    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  // Construct Query String Helper based on active filters
  function getFilterQuery() {
    const params = new URLSearchParams();
    if (selectedMonth && selectedMonth !== 'all') params.append('month', selectedMonth);
    if (selectedProvider && selectedProvider !== 'all') params.append('provider', selectedProvider);
    if (filterStartDate) params.append('startDate', filterStartDate);
    if (filterEndDate) params.append('endDate', filterEndDate);
    return params.toString();
  }

  // Master Refresh
  async function refreshDashboard() {
    await Promise.all([
      loadKPIs(),
      loadBudget(),
      loadMonthlyComparison(),
      loadSavingsCalculator(currentSavingsPct),
      loadTrendChart(currentTrendRange),
      loadProviderBreakdown(),
      loadTopServices(),
      loadCategoryBreakdown(),
      loadBillingRecords(),
      loadAnomalies(currentAnomalyFilter),
      loadRecommendations()
    ]);
  }

  // 1. Fetch & Populate Months Dropdown
  async function loadMonths() {
    try {
      const res = await fetch('/api/months');
      const json = await res.json();
      if (!json.success) return;

      const select = document.getElementById('filterMonthSelect');
      select.innerHTML = '<option value="all">All Available History</option>';
      json.data.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.month;
        opt.textContent = `${m.month} (${formatCompactUSD(m.total)})`;
        select.appendChild(opt);
      });
    } catch (err) {
      console.error('Failed to load months:', err);
    }
  }

  // 2. Fetch & Render KPIs
  async function loadKPIs() {
    try {
      const q = getFilterQuery();
      const res = await fetch(`/api/kpi?${q}`);
      const json = await res.json();
      if (!json.success) return;
      const kpis = json.data;

      document.getElementById('kpiTotalSpend').textContent = formatUSD(kpis.totalSpend);
      document.getElementById('kpiDailyBurn').textContent = formatUSD(kpis.dailyBurnRate);
      document.getElementById('kpi30DayProjection').textContent = formatUSD(kpis.projected30DaySpend);
      document.getElementById('kpiRealizedSavings').textContent = formatUSD(kpis.realizedSavings);

      // Period Growth Badge
      const growthEl = document.getElementById('kpiPeriodGrowth');
      if (growthEl) {
        growthEl.innerHTML = `<i data-lucide="${kpis.periodGrowthPct >= 0 ? 'trending-up' : 'trending-down'}" class="w-3 h-3 mr-0.5"></i> ${kpis.periodGrowthPct >= 0 ? '+' : ''}${kpis.periodGrowthPct}%`;
        growthEl.className = `text-xs font-medium flex items-center ${kpis.periodGrowthPct >= 0 ? 'text-amber-400' : 'text-emerald-400'}`;
      }

      // Deduction label
      const deductionEl = document.getElementById('projectionSavingsDeduction');
      if (deductionEl) {
        if (kpis.realizedSavings > 0) {
          deductionEl.textContent = `-${formatUSD(kpis.realizedSavings)}/mo realized`;
          deductionEl.classList.remove('hidden');
        } else {
          deductionEl.classList.add('hidden');
        }
      }

      // Applied count
      const appliedCountEl = document.getElementById('kpiAppliedCount');
      if (appliedCountEl) {
        appliedCountEl.textContent = `${kpis.appliedRecommendations} of ${kpis.totalRecommendations} Applied`;
      }

      // Open Anomalies Badge
      const openAnomBadge = document.getElementById('openAnomaliesBadge');
      if (openAnomBadge) {
        openAnomBadge.textContent = `${kpis.openAnomalies} Active Spikes`;
        openAnomBadge.className = kpis.openAnomalies === 0
          ? 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          : 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30';
      }

      // Date range label
      const rangeEl = document.getElementById('dateRangeLabel');
      if (rangeEl) {
        let label = 'Full Historical Telemetry';
        if (selectedMonth && selectedMonth !== 'all') label = `Filter: ${selectedMonth}`;
        else if (filterStartDate && filterEndDate) label = `${filterStartDate} to ${filterEndDate}`;
        rangeEl.textContent = `${label} &bull; ${kpis.totalRecords} records`;
      }

      // Sync record counters across navbar, banner, and table badges
      if (kpis.totalRecords !== undefined) {
        const formattedTotal = kpis.totalRecords.toLocaleString();
        const navBadge = document.getElementById('navRecordsBadge');
        if (navBadge) navBadge.textContent = formattedTotal;
        const bannerCount = document.getElementById('bannerRecordCount');
        if (bannerCount) bannerCount.textContent = formattedTotal;
        const tableBadge = document.getElementById('tableTotalRecordsBadge');
        if (tableBadge) tableBadge.textContent = `${formattedTotal} Records`;
      }

      refreshIcons();
    } catch (err) {
      console.error('Failed to load KPIs:', err);
    }
  }

  // 3. Budget Management
  async function loadBudget() {
    try {
      const monthParam = (selectedMonth && selectedMonth !== 'all') ? `?month=${selectedMonth}` : '';
      const res = await fetch(`/api/budget${monthParam}`);
      const json = await res.json();
      if (!json.success) return;
      const b = json.data;

      document.getElementById('budgetAmountLabel').textContent = formatUSD(b.budgetAmount);
      document.getElementById('budgetCurrentSpendLabel').textContent = formatUSD(b.currentSpend);
      document.getElementById('budgetRemainingLabel').textContent = formatUSD(b.remainingBalance);
      document.getElementById('budgetUtilizationPctLabel').textContent = `${b.utilizationPct}%`;

      const progressBar = document.getElementById('budgetProgressBar');
      const widthPct = Math.min(100, Math.max(0, b.utilizationPct));
      progressBar.style.width = `${widthPct}%`;

      const banner = document.getElementById('budgetAlertBanner');
      const statusDesc = document.getElementById('budgetStatusDescription');

      if (b.alertLevel === 'critical') {
        progressBar.className = 'h-3 rounded-full transition-all duration-700 bg-rose-500';
        banner.className = 'rounded-xl p-3.5 border border-rose-500/40 bg-rose-950/40 text-rose-200 flex items-center justify-between text-xs mb-4';
        banner.innerHTML = `
          <div class="flex items-center space-x-2">
            <i data-lucide="alert-octagon" class="w-4 h-4 text-rose-400 shrink-0"></i>
            <span><strong>CRITICAL BUDGET OVERRUN:</strong> Current monthly spend exceeds allocated budget by <strong>${formatUSD(Math.abs(b.remainingBalance))}</strong> (${b.utilizationPct}% utilized).</span>
          </div>
          <button onclick="document.getElementById('openBudgetModalBtn').click()" class="bg-rose-600 hover:bg-rose-500 text-white font-semibold px-2.5 py-1 rounded text-[11px] shrink-0">Adjust Budget</button>
        `;
        banner.classList.remove('hidden');
        statusDesc.innerHTML = `<span class="text-rose-400 font-semibold">&bull; Overbudget:</span> Review high spend services and apply recommendations below.`;
      } else if (b.alertLevel === 'warning') {
        progressBar.className = 'h-3 rounded-full transition-all duration-700 bg-amber-500';
        banner.className = 'rounded-xl p-3.5 border border-amber-500/40 bg-amber-950/40 text-amber-200 flex items-center justify-between text-xs mb-4';
        banner.innerHTML = `
          <div class="flex items-center space-x-2">
            <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 shrink-0"></i>
            <span><strong>BUDGET WARNING:</strong> Monthly spend has reached <strong>${b.utilizationPct}%</strong> of threshold with ${formatUSD(b.remainingBalance)} remaining.</span>
          </div>
          <button onclick="document.getElementById('openBudgetModalBtn').click()" class="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-2.5 py-1 rounded text-[11px] shrink-0">Increase Limit</button>
        `;
        banner.classList.remove('hidden');
        statusDesc.innerHTML = `<span class="text-amber-400 font-semibold">&bull; 80% Threshold Reached:</span> Approaching monthly ceiling for ${b.month}.`;
      } else {
        progressBar.className = 'h-3 rounded-full transition-all duration-700 bg-emerald-500';
        banner.classList.add('hidden');
        statusDesc.innerHTML = `<span class="text-emerald-400 font-semibold">&bull; Healthy Utilization:</span> Spending is within acceptable parameters for ${b.month}.`;
      }

      // Pre-fill budget modal inputs
      document.getElementById('budgetMonthInput').value = b.month;
      document.getElementById('budgetAmountInput').value = b.budgetAmount;

      refreshIcons();
    } catch (err) {
      console.error('Failed to load budget:', err);
    }
  }

  // 4. Monthly Cost Comparison
  async function loadMonthlyComparison() {
    try {
      const res = await fetch('/api/comparison');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const c = json.data;

      document.getElementById('currentMonthNameLabel').textContent = `${c.currentMonth} Spend`;
      document.getElementById('currentMonthSpendLabel').textContent = formatUSD(c.currentSpend);

      document.getElementById('previousMonthNameLabel').textContent = `${c.previousMonth} Spend`;
      document.getElementById('previousMonthSpendLabel').textContent = formatUSD(c.previousSpend);

      const badge = document.getElementById('comparisonBadge');
      if (c.isIncrease) {
        badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30';
        badge.innerHTML = `<i data-lucide="trending-up" class="w-3 h-3 inline mr-1"></i> +${c.percentage}% ($${Math.abs(c.delta).toLocaleString()} increase)`;
      } else {
        badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
        badge.innerHTML = `<i data-lucide="trending-down" class="w-3 h-3 inline mr-1"></i> ${c.percentage}% ($${Math.abs(c.delta).toLocaleString()} savings)`;
      }

      refreshIcons();
    } catch (err) {
      console.error('Failed to load monthly comparison:', err);
    }
  }

  // 5. Savings Calculator
  async function loadSavingsCalculator(pct = 10) {
    try {
      currentSavingsPct = pct;
      const monthParam = (selectedMonth && selectedMonth !== 'all') ? `&month=${selectedMonth}` : '';
      const res = await fetch(`/api/calculator?reduction=${pct}${monthParam}`);
      const json = await res.json();
      if (!json.success) return;
      const calc = json.data;

      document.getElementById('calcMonthlySavingsLabel').textContent = formatUSD(calc.estimatedMonthlySavings);
      document.getElementById('calcAnnualSavingsLabel').textContent = formatUSD(calc.estimatedAnnualSavings);
      document.getElementById('calcNetSpendLabel').textContent = formatUSD(calc.remainingProjectedCost);

      // Highlight active button
      document.querySelectorAll('.calc-btn').forEach(b => {
        if (parseInt(b.getAttribute('data-pct')) === pct) {
          b.className = 'calc-btn px-3 py-1 rounded-md font-semibold bg-emerald-600 text-white transition';
        } else {
          b.className = 'calc-btn px-3 py-1 rounded-md font-semibold bg-slate-800 text-slate-300 hover:text-white transition';
        }
      });
    } catch (err) {
      console.error('Failed to calculate savings:', err);
    }
  }

  // 6. Daily Spend Trend Area Chart
  async function loadTrendChart(range = currentTrendRange) {
    try {
      const q = getFilterQuery();
      const res = await fetch(`/api/trends?range=${range}&${q}`);
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const labels = data.map(d => {
        const parts = d.date.split('-');
        return `${parts[1]}/${parts[2]}`;
      });

      const awsData = data.map(d => d.aws);
      const gcpData = data.map(d => d.gcp);
      const azureData = data.map(d => d.azure);

      const ctx = document.getElementById('trendChart').getContext('2d');

      const awsGradient = ctx.createLinearGradient(0, 0, 0, 300);
      awsGradient.addColorStop(0, 'rgba(255, 153, 0, 0.45)');
      awsGradient.addColorStop(1, 'rgba(255, 153, 0, 0.0)');

      const gcpGradient = ctx.createLinearGradient(0, 0, 0, 300);
      gcpGradient.addColorStop(0, 'rgba(66, 133, 244, 0.45)');
      gcpGradient.addColorStop(1, 'rgba(66, 133, 244, 0.0)');

      const azureGradient = ctx.createLinearGradient(0, 0, 0, 300);
      azureGradient.addColorStop(0, 'rgba(0, 137, 214, 0.45)');
      azureGradient.addColorStop(1, 'rgba(0, 137, 214, 0.0)');

      if (trendChartInstance) {
        trendChartInstance.destroy();
      }

      trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'AWS',
              data: awsData,
              borderColor: '#FF9900',
              backgroundColor: awsGradient,
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointRadius: data.length > 60 ? 0 : 2,
              pointHoverRadius: 5
            },
            {
              label: 'GCP',
              data: gcpData,
              borderColor: '#4285F4',
              backgroundColor: gcpGradient,
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointRadius: data.length > 60 ? 0 : 2,
              pointHoverRadius: 5
            },
            {
              label: 'Azure',
              data: azureData,
              borderColor: '#0089D6',
              backgroundColor: azureGradient,
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointRadius: data.length > 60 ? 0 : 2,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: { boxWidth: 12, color: '#94a3b8', font: { size: 11, family: 'Inter' } }
            },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#cbd5e1',
              borderColor: '#334155',
              borderWidth: 1,
              padding: 10,
              boxPadding: 4,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${formatUSD(ctx.parsed.y)}`
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(51, 65, 85, 0.2)' },
              ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 12 }
            },
            y: {
              grid: { color: 'rgba(51, 65, 85, 0.2)' },
              ticks: { color: '#64748b', font: { size: 10 }, callback: (val) => formatCompactUSD(val) }
            }
          }
        }
      });
    } catch (err) {
      console.error('Failed to load Trend Chart:', err);
    }
  }

  // 7. Provider Donut Chart
  async function loadProviderBreakdown() {
    try {
      const q = getFilterQuery();
      const res = await fetch(`/api/breakdown/provider?${q}`);
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const labels = data.map(d => d.provider);
      const values = data.map(d => d.totalCost);
      const percentages = data.map(d => d.percentage);

      const colors = { 'AWS': '#FF9900', 'GCP': '#4285F4', 'Azure': '#0089D6' };
      const bgColors = labels.map(l => colors[l] || '#94a3b8');

      const ctx = document.getElementById('providerDonutChart').getContext('2d');

      if (providerDonutInstance) {
        providerDonutInstance.destroy();
      }

      providerDonutInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: bgColors,
            borderColor: '#111827',
            borderWidth: 3,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#cbd5e1',
              borderColor: '#334155',
              borderWidth: 1,
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${formatUSD(ctx.parsed)} (${percentages[ctx.dataIndex]}%)`
              }
            }
          }
        }
      });

      const legendContainer = document.getElementById('providerLegendContainer');
      legendContainer.innerHTML = data.map(item => `
        <div class="flex items-center justify-between text-slate-300">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${colors[item.provider] || '#94a3b8'}"></span>
            <span class="font-medium">${item.provider}</span>
          </div>
          <div class="flex items-center space-x-2 font-mono">
            <span>${formatUSD(item.totalCost)}</span>
            <span class="text-slate-500">(${item.percentage}%)</span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load provider breakdown:', err);
    }
  }

  // 8. Top 5 Costly Services (With Search & Sorting)
  async function loadTopServices() {
    try {
      const q = getFilterQuery();
      const searchParam = topServicesSearch ? `&search=${encodeURIComponent(topServicesSearch)}` : '';
      const sortParam = `&sortBy=${encodeURIComponent(topServicesSort)}`;
      const res = await fetch(`/api/breakdown/services?limit=5&${q}${searchParam}${sortParam}`);
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const container = document.getElementById('topServicesListContainer');
      if (data.length === 0) {
        container.innerHTML = `
          <div class="p-6 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
            No costly cloud services matching filter "${topServicesSearch}".
          </div>
        `;
        return;
      }

      const providerBadgeColors = {
        'AWS': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        'GCP': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        'Azure': 'text-sky-400 bg-sky-500/10 border-sky-500/20'
      };

      const maxCost = data.length > 0 ? data[0].totalCost : 1;

      container.innerHTML = data.map((item, idx) => {
        const barPct = maxCost > 0 ? ((item.totalCost / maxCost) * 100).toFixed(0) : 0;
        return `
          <div class="p-3 bg-slate-900/50 hover:bg-slate-900/80 rounded-xl border border-slate-800/80 transition flex items-center justify-between gap-3 text-xs">
            <div class="flex items-center space-x-3 flex-1 min-w-0">
              <span class="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center font-bold font-mono text-slate-400 text-[11px] shrink-0">
                #${idx + 1}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center space-x-2">
                  <span class="font-bold text-white truncate">${item.service}</span>
                  <span class="px-1.5 py-0.2 rounded text-[10px] font-mono border ${providerBadgeColors[item.provider] || 'text-slate-300 bg-slate-800'}">${item.provider}</span>
                </div>
                <div class="w-full bg-slate-950 rounded-full h-1.5 mt-1.5 overflow-hidden">
                  <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${barPct}%"></div>
                </div>
              </div>
            </div>

            <div class="text-right shrink-0 font-mono">
              <span class="text-white font-bold block">${formatUSD(item.totalCost)}</span>
              <span class="text-[10px] text-slate-500">${item.category} &bull; ${item.recordCount} recs</span>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load top services:', err);
    }
  }

  // 9. Category Breakdown Progress Bars
  async function loadCategoryBreakdown() {
    try {
      const q = getFilterQuery();
      const res = await fetch(`/api/breakdown/categories?${q}`);
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const categoryColors = {
        'Compute': 'bg-blue-500',
        'Storage': 'bg-amber-500',
        'Database': 'bg-emerald-500',
        'Networking': 'bg-purple-500',
        'Serverless': 'bg-rose-500'
      };

      const container = document.getElementById('categoryBarsContainer');
      container.innerHTML = data.map(item => `
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center space-x-2">
              <span class="font-semibold text-slate-200">${item.category}</span>
              <span class="text-[10px] text-slate-500">${item.recordCount} telemetry records</span>
            </div>
            <div class="flex items-center space-x-2 font-mono">
              <span class="font-bold text-slate-100">${formatUSD(item.totalCost)}</span>
              <span class="text-slate-400">(${item.percentage}%)</span>
            </div>
          </div>
          <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
            <div class="h-2 rounded-full ${categoryColors[item.category] || 'bg-blue-500'} transition-all duration-700" style="width: ${item.percentage}%"></div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load category breakdown:', err);
    }
  }

  // 10. Billing Records Table (CRUD with Pagination & Search)
  async function loadBillingRecords() {
    try {
      const q = getFilterQuery();
      const searchParam = recordsSearch ? `&search=${encodeURIComponent(recordsSearch)}` : '';
      const res = await fetch(`/api/records?page=${recordsPage}&limit=10&${q}${searchParam}`);
      const json = await res.json();
      if (!json.success) return;

      const tbody = document.getElementById('billingRecordsTbody');
      const badge = document.getElementById('tableTotalRecordsBadge');
      if (badge) badge.textContent = `${json.total.toLocaleString()} Records`;
      const navBadge = document.getElementById('navRecordsBadge');
      if (navBadge) navBadge.textContent = `${json.total.toLocaleString()}`;
      const bannerCount = document.getElementById('bannerRecordCount');
      if (bannerCount) bannerCount.textContent = `${json.total.toLocaleString()}`;

      if (json.records.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="9" class="text-center py-8 text-slate-500 text-xs">
              <i data-lucide="inbox" class="w-7 h-7 mx-auto text-slate-600 mb-2"></i>
              <p>No billing records found matching your filters.</p>
              <button id="resetRecordsFilterBtn" class="mt-2.5 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition">
                <i data-lucide="rotate-ccw" class="w-3 h-3"></i>
                <span>Reset Filters to Show All Records</span>
              </button>
            </td>
          </tr>
        `;
        refreshIcons();
        const resetBtn = document.getElementById('resetRecordsFilterBtn');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            document.getElementById('resetFiltersBtn').click();
          });
        }
        document.getElementById('recordsPaginationInfo').textContent = '0 records found';
        return;
      }

      tbody.innerHTML = json.records.map(r => `
        <tr class="hover:bg-slate-900/60 transition" id="record-row-${r.id}">
          <td class="py-3 px-3 font-mono text-slate-400 font-semibold">#${r.id}</td>
          <td class="py-3 px-4 font-mono text-slate-400">${r.date}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
              r.provider === 'AWS' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
              r.provider === 'GCP' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
              'bg-sky-500/10 text-sky-400 border border-sky-500/20'
            }">${r.provider}</span>
          </td>
          <td class="py-3 px-4 font-semibold text-white">${r.service}</td>
          <td class="py-3 px-4 text-slate-400">${r.category}</td>
          <td class="py-3 px-4 font-mono text-slate-500">${r.region}</td>
          <td class="py-3 px-4 font-mono font-bold text-white">${formatUSD(r.cost)}</td>
          <td class="py-3 px-4 font-mono text-slate-400">${r.usage_amount} ${r.usage_unit}</td>
          <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
            <button class="edit-record-btn text-xs text-amber-400 hover:text-amber-300 font-medium px-2 py-1 rounded hover:bg-slate-800 transition" data-id="${r.id}">Edit</button>
            <button class="delete-record-btn text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded hover:bg-slate-800 transition" data-id="${r.id}">Delete</button>
          </td>
        </tr>
      `).join('');

      document.getElementById('recordsPaginationInfo').textContent = `Showing ${json.records.length} of ${json.total.toLocaleString()} records (Page ${json.page} of ${json.totalPages || 1})`;
      document.getElementById('currentPageBadge').textContent = json.page;

      document.getElementById('prevPageBtn').disabled = json.page <= 1;
      document.getElementById('nextPageBtn').disabled = json.page >= json.totalPages;

      // Attach row action listeners
      tbody.querySelectorAll('.edit-record-btn').forEach(b => {
        b.addEventListener('click', () => openEditModal(b.getAttribute('data-id')));
      });
      tbody.querySelectorAll('.delete-record-btn').forEach(b => {
        b.addEventListener('click', () => promptDeleteRecord(b.getAttribute('data-id')));
      });
    } catch (err) {
      console.error('Failed to load billing records:', err);
    }
  }

  // 11. Anomaly Center
  async function loadAnomalies(filter = currentAnomalyFilter) {
    try {
      const res = await fetch(`/api/anomalies?status=${filter}`);
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const container = document.getElementById('anomaliesListContainer');
      if (data.length === 0) {
        container.innerHTML = `
          <div class="text-center py-8 text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
            <i data-lucide="check-circle" class="w-8 h-8 mx-auto text-emerald-400 mb-2"></i>
            No ${filter} cost anomalies detected in this view.
          </div>
        `;
        refreshIcons();
        return;
      }

      container.innerHTML = data.map(item => {
        const isResolved = item.status === 'resolved';
        return `
          <div class="p-4 rounded-xl border ${isResolved ? 'border-slate-800/80 bg-slate-900/40 opacity-75' : 'border-rose-500/30 bg-rose-950/10'} transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div class="space-y-1.5 flex-1">
              <div class="flex items-center flex-wrap gap-2">
                <span class="px-2 py-0.5 rounded text-[11px] font-bold ${isResolved ? 'bg-slate-800 text-slate-400' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}">
                  +${item.deviation_pct}% Variance Spike
                </span>
                <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  ${item.provider} &middot; ${item.service}
                </span>
                <span class="text-xs font-mono text-slate-500">${item.date}</span>
                <span class="text-[11px] font-mono text-slate-400 truncate max-w-xs">${item.resource_id}</span>
              </div>
              <p class="text-xs text-slate-300 leading-relaxed">${item.root_cause}</p>
              <div class="flex items-center space-x-3 text-[11px] font-mono text-slate-400 pt-0.5">
                <span>Incurred: <strong class="text-rose-400">${formatUSD(item.actual_cost)}</strong></span>
                <span>&bull;</span>
                <span>Expected: <span class="text-slate-400">${formatUSD(item.expected_cost)}</span></span>
                ${isResolved && item.resolved_at ? `<span>&bull;</span> <span class="text-emerald-400">Resolved ${new Date(item.resolved_at).toLocaleDateString()}</span>` : ''}
              </div>
            </div>

            <div class="shrink-0 self-start md:self-center">
              <button class="toggle-anomaly-btn px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                isResolved
                  ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300'
                  : 'border-emerald-600/50 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300'
              }" data-id="${item.id}">
                ${isResolved ? 'Reopen Incident' : 'Mark as Resolved'}
              </button>
            </div>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.toggle-anomaly-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          await toggleAnomaly(id);
        });
      });

      refreshIcons();
    } catch (err) {
      console.error('Failed to load anomalies:', err);
    }
  }

  async function toggleAnomaly(id) {
    try {
      const res = await fetch(`/api/anomalies/${id}/toggle`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) return;

      showToast(json.message, 'info');
      await loadKPIs();
      await loadAnomalies(currentAnomalyFilter);
    } catch (err) {
      console.error('Failed to toggle anomaly:', err);
    }
  }

  // 12. Recommendations
  async function loadRecommendations() {
    try {
      const res = await fetch('/api/recommendations');
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const totalPotential = data.reduce((acc, r) => acc + r.monthly_savings, 0);
      document.getElementById('potentialSavingsLabel').textContent = `${formatUSD(totalPotential)}/mo`;

      const impactColors = {
        'High': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        'Medium': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        'Low': 'text-blue-400 bg-blue-500/10 border-blue-500/20'
      };

      const grid = document.getElementById('recommendationsGrid');
      grid.innerHTML = data.map(item => {
        const isApplied = item.status === 'applied';
        return `
          <div class="glass-panel p-5 rounded-xl border ${isApplied ? 'border-emerald-500/50 bg-emerald-950/15' : 'border-slate-800'} flex flex-col justify-between space-y-4 transition-all">
            <div class="space-y-2">
              <div class="flex items-start justify-between gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${impactColors[item.impact] || 'text-slate-300 bg-slate-800'}">
                  ${item.impact} Impact
                </span>
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  ${item.provider} &middot; ${item.category}
                </span>
              </div>
              <h4 class="text-sm font-bold text-white leading-snug">${item.title}</h4>
              <p class="text-xs text-slate-400 leading-relaxed">${item.description}</p>
            </div>

            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <span class="text-[10px] uppercase font-semibold text-slate-500 block">Est. Savings</span>
                <span class="text-base font-extrabold text-emerald-400 font-mono">+${formatUSD(item.monthly_savings)}<span class="text-xs text-slate-400 font-normal">/mo</span></span>
              </div>

              <button class="apply-rec-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1 ${
                isApplied
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-500/20'
              }" data-id="${item.id}">
                <i data-lucide="${isApplied ? 'check' : 'zap'}" class="w-3.5 h-3.5"></i>
                <span>${isApplied ? 'Applied' : 'Apply Action'}</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('.apply-rec-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          await applyRecommendation(id);
        });
      });

      refreshIcons();
    } catch (err) {
      console.error('Failed to load recommendations:', err);
    }
  }

  async function applyRecommendation(id) {
    try {
      const res = await fetch(`/api/recommendations/${id}/apply`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) return;

      showToast(json.message, 'success');
      await loadKPIs();
      await loadRecommendations();
      await loadBudget();
    } catch (err) {
      console.error('Failed to apply recommendation:', err);
    }
  }

  // --- CRUD Modal Actions ---
  async function openEditModal(id) {
    try {
      const res = await fetch(`/api/records/${id}`);
      const json = await res.json();
      if (!json.success) return;
      const r = json.data;

      document.getElementById('editRecordId').value = r.id;
      document.getElementById('editRecordIdDisplay').textContent = r.id;
      document.getElementById('editRecordDate').value = r.date;
      document.getElementById('editRecordProvider').value = r.provider;
      document.getElementById('editRecordService').value = r.service;
      document.getElementById('editRecordCategory').value = r.category;
      document.getElementById('editRecordRegion').value = r.region;
      document.getElementById('editRecordCost').value = r.cost;
      document.getElementById('editRecordUsage').value = r.usage_amount;
      document.getElementById('editRecordUnit').value = r.usage_unit;
      document.getElementById('editRecordResource').value = r.resource_id;

      document.getElementById('editRecordModal').classList.remove('hidden');
    } catch (err) {
      showToast('Could not load record for edit.', 'danger');
    }
  }

  function promptDeleteRecord(id) {
    pendingDeleteRecordId = id;
    document.getElementById('deleteRecordIdDisplay').textContent = id;
    document.getElementById('deleteConfirmModal').classList.remove('hidden');
  }

  // --- Event Listeners Setup ---

  // Month Filter Change
  document.getElementById('filterMonthSelect').addEventListener('change', (e) => {
    selectedMonth = e.target.value;
    filterStartDate = '';
    filterEndDate = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    recordsPage = 1;
    refreshDashboard();
  });

  // Provider Filter Pills
  document.querySelectorAll('.provider-pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.provider-pill-btn').forEach(b => {
        b.className = 'provider-pill-btn px-2.5 py-1 font-medium rounded-md text-slate-400 hover:text-white';
      });
      e.target.className = 'provider-pill-btn px-2.5 py-1 font-medium rounded-md bg-blue-600 text-white';
      selectedProvider = e.target.getAttribute('data-provider');
      recordsPage = 1;
      refreshDashboard();
    });
  });

  // Custom Date Range Apply
  document.getElementById('applyCustomDateBtn').addEventListener('click', () => {
    const s = document.getElementById('filterStartDate').value;
    const end = document.getElementById('filterEndDate').value;
    if (s && end && s > end) {
      showToast('Start date cannot be after end date.', 'warning');
      return;
    }
    filterStartDate = s;
    filterEndDate = end;
    if (s || end) {
      selectedMonth = 'all';
      document.getElementById('filterMonthSelect').value = 'all';
    }
    recordsPage = 1;
    refreshDashboard();
    showToast('Date range filter applied.', 'info');
  });

  // Reset Filters
  document.getElementById('resetFiltersBtn').addEventListener('click', () => {
    selectedMonth = 'all';
    selectedProvider = 'all';
    filterStartDate = '';
    filterEndDate = '';
    document.getElementById('filterMonthSelect').value = 'all';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.querySelectorAll('.provider-pill-btn').forEach((b, idx) => {
      b.className = idx === 0
        ? 'provider-pill-btn px-2.5 py-1 font-medium rounded-md bg-blue-600 text-white'
        : 'provider-pill-btn px-2.5 py-1 font-medium rounded-md text-slate-400 hover:text-white';
    });
    recordsPage = 1;
    refreshDashboard();
    showToast('Filters reset to default.', 'info');
  });

  // Trend Range Filter Buttons
  document.querySelectorAll('.trend-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.trend-filter-btn').forEach(b => {
        b.className = 'trend-filter-btn px-3 py-1 font-medium rounded-md text-slate-300 hover:text-white transition';
      });
      e.target.className = 'trend-filter-btn px-3 py-1 font-medium rounded-md bg-blue-600 text-white font-semibold transition';
      currentTrendRange = e.target.getAttribute('data-range');
      loadTrendChart(currentTrendRange);
    });
  });

  // Savings Calculator Buttons
  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const pct = parseInt(e.target.getAttribute('data-pct'));
      loadSavingsCalculator(pct);
    });
  });

  document.getElementById('calcCustomBtn').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('calcCustomInput').value);
    if (isNaN(val) || val <= 0 || val > 100) {
      showToast('Enter a valid reduction percentage between 1 and 100.', 'warning');
      return;
    }
    loadSavingsCalculator(val);
  });

  // Top Services Search & Sort
  document.getElementById('topServicesSearchInput').addEventListener('input', (e) => {
    topServicesSearch = e.target.value.trim();
    loadTopServices();
  });

  document.getElementById('topServicesSortSelect').addEventListener('change', (e) => {
    topServicesSort = e.target.value;
    loadTopServices();
  });

  // Records Table Search & Pagination
  let searchTimeout = null;
  document.getElementById('recordsSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      recordsSearch = e.target.value.trim();
      recordsPage = 1;
      loadBillingRecords();
    }, 300);
  });

  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (recordsPage > 1) {
      recordsPage--;
      loadBillingRecords();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    recordsPage++;
    loadBillingRecords();
  });

  // Anomaly Filter Buttons
  document.querySelectorAll('.anomaly-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.anomaly-filter-btn').forEach(b => {
        b.className = 'anomaly-filter-btn px-3 py-1 font-medium rounded-md text-slate-400 hover:text-white';
      });
      e.target.className = 'anomaly-filter-btn px-3 py-1 font-medium rounded-md bg-slate-800 text-white';
      currentAnomalyFilter = e.target.getAttribute('data-filter');
      loadAnomalies(currentAnomalyFilter);
    });
  });

  // Anomaly Scan Button
  const scanBtn = document.getElementById('runScanBtn');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      try {
        scanBtn.disabled = true;
        scanBtn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> <span>Scanning...</span>`;
        refreshIcons();

        const res = await fetch('/api/anomalies/scan', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          showToast(`Baseline Scan Complete: ${json.detectedCount} statistical spikes detected (${json.newInserted} new).`, 'info');
          await loadKPIs();
          await loadAnomalies(currentAnomalyFilter);
        }
      } catch (err) {
        showToast('Scan failed.', 'danger');
      } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = `<i data-lucide="scan" class="w-3.5 h-3.5 text-blue-400"></i> <span>Run Baseline Scan</span>`;
        refreshIcons();
      }
    });
  }

  // --- Modals Setup ---

  // Ingest / Add Record Modal
  const ingestModal = document.getElementById('ingestModal');
  const openIngestModal = () => {
    document.getElementById('ingestDate').value = new Date().toISOString().split('T')[0];
    ingestModal.classList.remove('hidden');
  };
  document.getElementById('openIngestModalBtn').addEventListener('click', openIngestModal);
  document.getElementById('addRecordTableBtn').addEventListener('click', openIngestModal);
  const quickAddBtn = document.getElementById('addRecordQuickBtn');
  if (quickAddBtn) quickAddBtn.addEventListener('click', openIngestModal);
  document.getElementById('closeIngestModalBtn').addEventListener('click', () => ingestModal.classList.add('hidden'));
  document.getElementById('cancelIngestBtn').addEventListener('click', () => ingestModal.classList.add('hidden'));

  document.getElementById('ingestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cost = parseFloat(document.getElementById('ingestCost').value);
    if (isNaN(cost) || cost <= 0) {
      showToast('Please enter a valid cost greater than $0.', 'warning');
      return;
    }

    const payload = {
      date: document.getElementById('ingestDate').value,
      provider: document.getElementById('ingestProvider').value,
      service: document.getElementById('ingestService').value,
      category: document.getElementById('ingestCategory').value,
      region: document.getElementById('ingestRegion').value,
      cost,
      usage_amount: parseFloat(document.getElementById('ingestUsage').value) || 0,
      usage_unit: document.getElementById('ingestUnit').value,
      resource_id: document.getElementById('ingestResourceId').value
    };

    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        showToast('Billing record created successfully.', 'success');
        ingestModal.classList.add('hidden');
        document.getElementById('ingestForm').reset();

        // Reset search and pagination to page 1 so user immediately sees their record at the top of the table
        recordsPage = 1;
        recordsSearch = '';
        const searchInput = document.getElementById('recordsSearchInput');
        if (searchInput) searchInput.value = '';

        // If active month filter doesn't match the new record's month, reset to 'all' so it is visible
        const recordMonth = payload.date.slice(0, 7);
        if (selectedMonth !== 'all' && selectedMonth !== recordMonth) {
          selectedMonth = 'all';
          const monthSelect = document.getElementById('filterMonthSelect');
          if (monthSelect) monthSelect.value = 'all';
        }

        await refreshDashboard();

        // Smooth scroll straight down to the Billing Records Table
        const tableSec = document.getElementById('billingRecordsSection');
        if (tableSec) {
          tableSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Highlight the newly created record in green so user clearly sees it
        if (json.record && json.record.id) {
          setTimeout(() => {
            const row = document.getElementById(`record-row-${json.record.id}`);
            if (row) {
              row.classList.add('bg-emerald-950/70', 'ring-2', 'ring-emerald-400');
              setTimeout(() => row.classList.remove('bg-emerald-950/70', 'ring-2', 'ring-emerald-400'), 5000);
            }
          }, 300);
        }
      } else {
        showToast(json.error || 'Failed to create record.', 'danger');
      }
    } catch (err) {
      showToast('Network error while saving record.', 'danger');
    }
  });

  // Edit Record Modal
  const editModal = document.getElementById('editRecordModal');
  document.getElementById('closeEditModalBtn').addEventListener('click', () => editModal.classList.add('hidden'));
  document.getElementById('cancelEditModalBtn').addEventListener('click', () => editModal.classList.add('hidden'));

  document.getElementById('editRecordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editRecordId').value;
    const cost = parseFloat(document.getElementById('editRecordCost').value);
    if (isNaN(cost) || cost <= 0) {
      showToast('Please enter a valid cost greater than $0.', 'warning');
      return;
    }

    const payload = {
      date: document.getElementById('editRecordDate').value,
      provider: document.getElementById('editRecordProvider').value,
      service: document.getElementById('editRecordService').value,
      category: document.getElementById('editRecordCategory').value,
      region: document.getElementById('editRecordRegion').value,
      cost,
      usage_amount: parseFloat(document.getElementById('editRecordUsage').value) || 0,
      usage_unit: document.getElementById('editRecordUnit').value,
      resource_id: document.getElementById('editRecordResource').value
    };

    try {
      const res = await fetch(`/api/records/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        showToast(`Record #${id} updated successfully.`, 'success');
        editModal.classList.add('hidden');
        await refreshDashboard();
      } else {
        showToast(json.error || 'Failed to update record.', 'danger');
      }
    } catch (err) {
      showToast('Error updating record.', 'danger');
    }
  });

  // Delete Confirm Modal
  const deleteModal = document.getElementById('deleteConfirmModal');
  document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    pendingDeleteRecordId = null;
    deleteModal.classList.add('hidden');
  });

  document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (!pendingDeleteRecordId) return;
    try {
      const res = await fetch(`/api/records/${pendingDeleteRecordId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast(`Record #${pendingDeleteRecordId} deleted successfully.`, 'success');
        deleteModal.classList.add('hidden');
        pendingDeleteRecordId = null;
        await refreshDashboard();
      } else {
        showToast(json.error || 'Failed to delete record.', 'danger');
      }
    } catch (err) {
      showToast('Error deleting record.', 'danger');
    }
  });

  // Budget Modal
  const budgetModal = document.getElementById('budgetModal');
  const openBudgetModal = () => budgetModal.classList.remove('hidden');
  document.getElementById('openBudgetModalBtn').addEventListener('click', openBudgetModal);
  document.getElementById('editBudgetBtn').addEventListener('click', openBudgetModal);
  document.getElementById('closeBudgetModalBtn').addEventListener('click', () => budgetModal.classList.add('hidden'));
  document.getElementById('cancelBudgetBtn').addEventListener('click', () => budgetModal.classList.add('hidden'));

  document.getElementById('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('budgetAmountInput').value);
    const month = document.getElementById('budgetMonthInput').value;

    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid budget amount greater than $0.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, amount })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message, 'success');
        budgetModal.classList.add('hidden');
        await loadBudget();
        await loadKPIs();
      } else {
        showToast(json.error || 'Failed to set budget.', 'danger');
      }
    } catch (err) {
      showToast('Error saving budget.', 'danger');
    }
  });

  // Export Hub Handlers
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const q = getFilterQuery();
    showToast('Downloading verified CSV audit report...', 'info');
    window.location.href = `/api/export/csv?${q}`;
  });

  document.getElementById('exportPdfBtn').addEventListener('click', () => {
    showToast('Opening printable executive report...', 'info');
    window.open('/api/export/report', '_blank');
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const q = getFilterQuery();
    showToast('Exporting executive FinOps audit JSON...', 'info');
    window.location.href = `/api/export/json?${q}`;
  });

  // Initial Boot
  loadMonths().then(() => {
    refreshDashboard();
  });
});
