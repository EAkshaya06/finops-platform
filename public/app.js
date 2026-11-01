// FinOps Executive Dashboard Client Application
document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let currentTrendRange = '180d';
  let currentAnomalyFilter = 'all';
  let trendChartInstance = null;
  let providerDonutInstance = null;
  let servicesBarInstance = null;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Formatters
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

  // Toast System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center space-x-2 px-4 py-3 rounded-xl border shadow-xl text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 ${
      type === 'success' 
        ? 'bg-slate-900/95 border-emerald-500/40 text-emerald-300 shadow-emerald-950/40' 
        : 'bg-slate-900/95 border-blue-500/40 text-blue-300 shadow-blue-950/40'
    }`;

    const icon = type === 'success' ? 'check-circle' : 'info';
    toast.innerHTML = `
      <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    if (window.lucide) window.lucide.createIcons();

    // Animate in
    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    // Auto dismiss
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // 1. Fetch & Render KPIs
  async function loadKPIs() {
    try {
      const res = await fetch('/api/kpi');
      const json = await res.json();
      if (!json.success) return;
      const kpis = json.data;

      // Update KPI DOM elements
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

      // Projection Savings Deduction label
      const deductionEl = document.getElementById('projectionSavingsDeduction');
      if (deductionEl) {
        if (kpis.realizedSavings > 0) {
          deductionEl.textContent = `-${formatUSD(kpis.realizedSavings)}/mo savings`;
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
        if (kpis.openAnomalies === 0) {
          openAnomBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        } else {
          openAnomBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30';
        }
      }

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      console.error('Failed to load KPIs:', err);
    }
  }

  // 2. Fetch & Render Daily Spend Trend Area Chart
  async function loadTrendChart(range = currentTrendRange) {
    try {
      const res = await fetch(`/api/trends?range=${range}`);
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

      // Gradient fills
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
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                boxWidth: 12,
                color: '#94a3b8',
                font: { size: 11, family: 'Inter' }
              }
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
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                maxTicksLimit: 12
              }
            },
            y: {
              grid: { color: 'rgba(51, 65, 85, 0.2)' },
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                callback: (val) => formatCompactUSD(val)
              }
            }
          }
        }
      });
    } catch (err) {
      console.error('Failed to load Trend Chart:', err);
    }
  }

  // 3. Fetch & Render Provider Donut Chart
  async function loadProviderBreakdown() {
    try {
      const res = await fetch('/api/breakdown/provider');
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const labels = data.map(d => d.provider);
      const values = data.map(d => d.totalCost);
      const percentages = data.map(d => d.percentage);

      const colors = {
        'AWS': '#FF9900',
        'GCP': '#4285F4',
        'Azure': '#0089D6'
      };

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

      // Populate custom legend
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

  // 4. Fetch & Render Top 6 Cost-Driving Services Bar Chart
  async function loadTopServices() {
    try {
      const res = await fetch('/api/breakdown/services?limit=6');
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      const labels = data.map(d => `${d.service} (${d.provider})`);
      const values = data.map(d => d.totalCost);

      const colors = {
        'AWS': '#FF9900',
        'GCP': '#4285F4',
        'Azure': '#0089D6'
      };

      const barColors = data.map(d => colors[d.provider] || '#3B82F6');

      const ctx = document.getElementById('servicesBarChart').getContext('2d');

      if (servicesBarInstance) {
        servicesBarInstance.destroy();
      }

      servicesBarInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: barColors,
            borderRadius: 6,
            borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#cbd5e1',
              borderColor: '#334155',
              borderWidth: 1,
              callbacks: {
                label: (ctx) => ` Total Spend: ${formatUSD(ctx.parsed.x)}`
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(51, 65, 85, 0.2)' },
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                callback: (val) => formatCompactUSD(val)
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: '#cbd5e1',
                font: { size: 11, family: 'Inter' }
              }
            }
          }
        }
      });

    } catch (err) {
      console.error('Failed to load top services:', err);
    }
  }

  // 5. Fetch & Render Category Progress Bars
  async function loadCategoryBreakdown() {
    try {
      const res = await fetch('/api/breakdown/categories');
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

  // 6. Fetch & Render Anomalies
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
        if (window.lucide) window.lucide.createIcons();
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
                <span class="text-xs font-mono text-slate-500">
                  ${item.date}
                </span>
                <span class="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                  ${item.resource_id}
                </span>
              </div>
              <p class="text-xs text-slate-300 leading-relaxed">
                ${item.root_cause}
              </p>
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

      // Add click listeners to toggle buttons
      container.querySelectorAll('.toggle-anomaly-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.getAttribute('data-id');
          await toggleAnomaly(id);
        });
      });

      if (window.lucide) window.lucide.createIcons();
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

  // 7. Fetch & Render Cost Optimization Recommendations
  async function loadRecommendations() {
    try {
      const res = await fetch('/api/recommendations');
      const json = await res.json();
      if (!json.success) return;
      const data = json.data;

      // Calculate total available potential savings
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

      // Add listeners to apply buttons
      grid.querySelectorAll('.apply-rec-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const target = e.currentTarget;
          const id = target.getAttribute('data-id');
          await applyRecommendation(id);
        });
      });

      if (window.lucide) window.lucide.createIcons();
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
    } catch (err) {
      console.error('Failed to apply recommendation:', err);
    }
  }

  // 8. Trend Filter Buttons Listener
  document.querySelectorAll('.trend-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.trend-filter-btn').forEach(b => {
        b.className = 'trend-filter-btn px-3 py-1 text-xs font-medium rounded-md text-slate-300 hover:text-white transition';
      });
      e.target.className = 'trend-filter-btn px-3 py-1 text-xs font-medium rounded-md bg-blue-600 text-white font-semibold transition';
      currentTrendRange = e.target.getAttribute('data-range');
      loadTrendChart(currentTrendRange);
    });
  });

  // 9. Anomaly Filter Buttons Listener
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

  // 10. Run Baseline Scan Button
  const scanBtn = document.getElementById('runScanBtn');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      try {
        scanBtn.disabled = true;
        scanBtn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> <span>Scanning...</span>`;
        if (window.lucide) window.lucide.createIcons();

        const res = await fetch('/api/anomalies/scan', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          showToast(`Baseline Scan Complete: ${json.detectedCount} statistical spikes detected (${json.newInserted} new).`, 'info');
          await loadKPIs();
          await loadAnomalies(currentAnomalyFilter);
        }
      } catch (err) {
        console.error('Scan failed:', err);
      } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = `<i data-lucide="scan" class="w-3.5 h-3.5 text-blue-400"></i> <span>Run Baseline Scan</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  // 11. Export Hub Buttons
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    showToast('Preparing complete CSV billing export...', 'info');
    window.location.href = '/api/export/csv';
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    showToast('Generating executive FinOps JSON audit report...', 'info');
    window.location.href = '/api/export/json';
  });

  // 12. Ingestion Modal Logic
  const modal = document.getElementById('ingestModal');
  const openModalBtn = document.getElementById('openIngestModalBtn');
  const closeModalBtn = document.getElementById('closeIngestModalBtn');
  const cancelBtn = document.getElementById('cancelIngestBtn');
  const ingestForm = document.getElementById('ingestForm');

  openModalBtn.addEventListener('click', () => {
    // Default date to today
    document.getElementById('ingestDate').value = new Date().toISOString().split('T')[0];
    modal.classList.remove('hidden');
  });

  const closeModal = () => modal.classList.add('hidden');
  closeModalBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  ingestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      date: document.getElementById('ingestDate').value,
      provider: document.getElementById('ingestProvider').value,
      service: document.getElementById('ingestService').value,
      category: document.getElementById('ingestCategory').value,
      region: document.getElementById('ingestRegion').value,
      cost: parseFloat(document.getElementById('ingestCost').value),
      usage_amount: parseFloat(document.getElementById('ingestUsage').value),
      usage_unit: document.getElementById('ingestUnit').value,
      resource_id: document.getElementById('ingestResourceId').value
    };

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        showToast('Billing record committed to SQLite!', 'success');
        closeModal();
        ingestForm.reset();
        // Refresh all dashboard views
        await loadAllDashboardData();
      } else {
        alert(json.error || 'Ingestion failed');
      }
    } catch (err) {
      console.error('Ingestion error:', err);
    }
  });

  // Global loader
  async function loadAllDashboardData() {
    await Promise.all([
      loadKPIs(),
      loadTrendChart(currentTrendRange),
      loadProviderBreakdown(),
      loadTopServices(),
      loadCategoryBreakdown(),
      loadAnomalies(currentAnomalyFilter),
      loadRecommendations()
    ]);

    // Update Date Range Label
    try {
      const res = await fetch('/api/trends?range=180d');
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        const first = json.data[0].date;
        const last = json.data[json.data.length - 1].date;
        document.getElementById('dateRangeLabel').textContent = `${first} to ${last} (${json.count} Days)`;
      }
    } catch (e) {}
  }

  // Initial Boot
  loadAllDashboardData();
});
