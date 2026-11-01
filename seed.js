const { FinOpsDB } = require('./db');
const path = require('node:path');
const fs = require('node:fs');

function seedDatabase(dbPath) {
  const dbInstance = new FinOpsDB(dbPath);
  const db = dbInstance.db;

  console.log('--- Initializing FinOps Database Seeder ---');

  // Clear existing data for a clean, deterministic seed
  db.exec('DELETE FROM billing_records;');
  db.exec('DELETE FROM anomalies;');
  db.exec('DELETE FROM recommendations;');

  const servicesConfig = [
    // AWS
    { provider: 'AWS', service: 'EC2', category: 'Compute', baseCost: 125, baseUsage: 720, unit: 'Hrs', regions: ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-1'], resourcePrefix: 'i-0' },
    { provider: 'AWS', service: 'S3', category: 'Storage', baseCost: 48, baseUsage: 2150, unit: 'GB-Mo', regions: ['us-east-1', 'eu-central-1'], resourcePrefix: 'arn:aws:s3:::prod-data-' },
    { provider: 'AWS', service: 'RDS', category: 'Database', baseCost: 85, baseUsage: 720, unit: 'Hrs', regions: ['us-east-1', 'us-west-2'], resourcePrefix: 'rds-pg-prod-' },
    { provider: 'AWS', service: 'NAT Gateway', category: 'Networking', baseCost: 36, baseUsage: 850, unit: 'GB', regions: ['us-east-1', 'eu-central-1'], resourcePrefix: 'nat-0' },
    { provider: 'AWS', service: 'Lambda', category: 'Serverless', baseCost: 18, baseUsage: 14500000, unit: 'Invocations', regions: ['us-east-1', 'us-west-2'], resourcePrefix: 'arn:aws:lambda:prod-' },

    // GCP
    { provider: 'GCP', service: 'Compute Engine', category: 'Compute', baseCost: 110, baseUsage: 720, unit: 'Hrs', regions: ['us-central1', 'europe-west3', 'asia-east1'], resourcePrefix: 'gcp-inst-worker-' },
    { provider: 'GCP', service: 'BigQuery', category: 'Database', baseCost: 75, baseUsage: 18500, unit: 'Queries', regions: ['us-central1', 'europe-west3'], resourcePrefix: 'bq-analytics-dataset-' },
    { provider: 'GCP', service: 'GCS', category: 'Storage', baseCost: 42, baseUsage: 1950, unit: 'GB-Mo', regions: ['us-central1', 'europe-west3'], resourcePrefix: 'gs://gcp-prod-backups-' },
    { provider: 'GCP', service: 'Cloud Run', category: 'Serverless', baseCost: 22, baseUsage: 4500000, unit: 'Requests', regions: ['us-central1'], resourcePrefix: 'crun-api-gateway-' },
    { provider: 'GCP', service: 'Cloud Load Balancing', category: 'Networking', baseCost: 28, baseUsage: 680, unit: 'GB', regions: ['us-central1', 'europe-west3'], resourcePrefix: 'gcp-lb-global-' },

    // Azure
    { provider: 'Azure', service: 'Virtual Machines', category: 'Compute', baseCost: 105, baseUsage: 720, unit: 'Hrs', regions: ['eastus', 'westeurope', 'southeastasia'], resourcePrefix: 'vm-azure-prod-' },
    { provider: 'Azure', service: 'Blob Storage', category: 'Storage', baseCost: 39, baseUsage: 1800, unit: 'GB-Mo', regions: ['eastus', 'westeurope'], resourcePrefix: 'az-blob-lake-' },
    { provider: 'Azure', service: 'Cosmos DB', category: 'Database', baseCost: 65, baseUsage: 288000, unit: 'RU-Hrs', regions: ['eastus', 'westeurope'], resourcePrefix: 'cosmos-account-global-' },
    { provider: 'Azure', service: 'Azure Functions', category: 'Serverless', baseCost: 16, baseUsage: 3800000, unit: 'Executions', regions: ['eastus'], resourcePrefix: 'func-event-broker-' },
    { provider: 'Azure', service: 'Virtual Network & VPN', category: 'Networking', baseCost: 31, baseUsage: 620, unit: 'GB', regions: ['eastus', 'westeurope'], resourcePrefix: 'vnet-gateway-prod-' }
  ];

  const regionVariance = {
    'us-east-1': 1.00,
    'us-west-2': 1.05,
    'eu-central-1': 1.12,
    'ap-southeast-1': 1.18,
    'us-central1': 1.00,
    'us-east4': 1.04,
    'europe-west3': 1.10,
    'asia-east1': 1.15,
    'eastus': 1.00,
    'westus2': 1.06,
    'westeurope': 1.14,
    'southeastasia': 1.17
  };

  const records = [];
  const TOTAL_DAYS = 180;
  const today = new Date();

  console.log(`Generating daily records spanning 180 days (6 months)...`);

  for (let dayOffset = TOTAL_DAYS - 1; dayOffset >= 0; dayOffset--) {
    // Use UTC date to ensure exact consistency across timezones and SQLite strftime
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOffset));
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

    // Realistic seasonal growth: 25% growth over 180 days
    const progress = (TOTAL_DAYS - dayOffset) / TOTAL_DAYS;
    const growthMultiplier = 1.0 + (progress * 0.25);

    for (const item of servicesConfig) {
      // Pick regions for this service on this day
      for (const reg of item.regions) {
        const regionalFactor = regionVariance[reg] || 1.0;

        // Weekend dip: compute/network/serverless/database drop 28%-32%, storage drops 12%
        let weekendFactor = 1.0;
        if (isWeekend) {
          weekendFactor = (item.category === 'Storage') ? 0.88 : 0.70;
        }

        // Daily smooth sinusoidal jitter: +/- 4%
        const jitter = 0.96 + (Math.sin(dayOffset * 7 + item.service.length) * 0.04);

        const cost = item.baseCost * regionalFactor * growthMultiplier * weekendFactor * jitter;
        const usage = item.baseUsage * growthMultiplier * weekendFactor * jitter;

        const resourceNum = Math.abs(Math.floor(Math.sin(dayOffset + reg.length) * 8999)) + 1000;
        const resourceId = `${item.resourcePrefix}${resourceNum}`;

        records.push({
          date: dateStr,
          provider: item.provider,
          service: item.service,
          category: item.category,
          region: reg,
          cost: Number(cost.toFixed(2)),
          usage_amount: Number(usage.toFixed(2)),
          usage_unit: item.unit,
          resource_id: resourceId,
          tags: {
            environment: dayOffset % 5 === 0 ? 'staging' : 'production',
            cost_center: `cc-${item.category.toLowerCase()}`,
            managed_by: 'terraform'
          }
        });
      }
    }
  }

  // Inject intentional cost spikes for specific days to trigger statistical anomaly detection
  // Spike 1: AWS EC2 surge 45 days ago
  const dateSpike1 = new Date(today);
  dateSpike1.setDate(dateSpike1.getDate() - 45);
  const dateStrSpike1 = dateSpike1.toISOString().split('T')[0];
  records.push({
    date: dateStrSpike1,
    provider: 'AWS',
    service: 'EC2',
    category: 'Compute',
    region: 'us-east-1',
    cost: 410.50,
    usage_amount: 1440,
    usage_unit: 'Hrs',
    resource_id: 'i-09ab7c12f45ec7',
    tags: { environment: 'production', incident: 'load-test-leak' }
  });

  // Spike 2: GCP BigQuery unpartitioned scan 22 days ago
  const dateSpike2 = new Date(today);
  dateSpike2.setDate(dateSpike2.getDate() - 22);
  const dateStrSpike2 = dateSpike2.toISOString().split('T')[0];
  records.push({
    date: dateStrSpike2,
    provider: 'GCP',
    service: 'BigQuery',
    category: 'Database',
    region: 'us-central1',
    cost: 385.20,
    usage_amount: 54000,
    usage_unit: 'Queries',
    resource_id: 'bq-analytics-dataset-eu',
    tags: { environment: 'production', incident: 'ad-hoc-full-scan' }
  });

  // Spike 3: AWS NAT Gateway routing loop 8 days ago
  const dateSpike3 = new Date(today);
  dateSpike3.setDate(dateSpike3.getDate() - 8);
  const dateStrSpike3 = dateSpike3.toISOString().split('T')[0];
  records.push({
    date: dateStrSpike3,
    provider: 'AWS',
    service: 'NAT Gateway',
    category: 'Networking',
    region: 'us-east-1',
    cost: 295.75,
    usage_amount: 5200,
    usage_unit: 'GB',
    resource_id: 'nat-0b3f89012',
    tags: { environment: 'production', incident: 'vpc-route-loop' }
  });

  // Spike 4: Azure Cosmos DB overprovisioned spike 4 days ago
  const dateSpike4 = new Date(today);
  dateSpike4.setDate(dateSpike4.getDate() - 4);
  const dateStrSpike4 = dateSpike4.toISOString().split('T')[0];
  records.push({
    date: dateStrSpike4,
    provider: 'Azure',
    service: 'Cosmos DB',
    category: 'Database',
    region: 'eastus',
    cost: 340.00,
    usage_amount: 960000,
    usage_unit: 'RU-Hrs',
    resource_id: 'cosmos-account-global-883',
    tags: { environment: 'production', incident: 'manual-scale-left-high' }
  });

  console.log(`Inserting ${records.length} billing records into SQLite...`);
  dbInstance.insertBulkRecords(records);
  console.log(`Successfully seeded ${records.length} billing records.`);

  // Seed Realistic Root-Cause Anomalies
  console.log('Seeding Anomaly Detection Center incidents...');
  const anomaliesSeed = [
    {
      date: dateStrSpike3,
      provider: 'AWS',
      service: 'NAT Gateway',
      resource_id: 'nat-0b3f89012',
      actual_cost: 295.75,
      expected_cost: 42.10,
      deviation_pct: 602.5,
      root_cause: 'NAT Gateway idle data processing fee spike caused by misconfigured VPC endpoint routing loop sending internal S3 traffic over public NAT in us-east-1.',
      status: 'open'
    },
    {
      date: dateStrSpike4,
      provider: 'Azure',
      service: 'Cosmos DB',
      resource_id: 'cosmos-account-global-883',
      actual_cost: 340.00,
      expected_cost: 78.50,
      deviation_pct: 333.1,
      root_cause: 'Overprovisioned idle Azure Cosmos DB Request Units: manual 40,000 RU/s throughput allocated during load-testing with <2% actual utilization left running over weekend.',
      status: 'open'
    },
    {
      date: dateStrSpike2,
      provider: 'GCP',
      service: 'BigQuery',
      resource_id: 'bq-analytics-dataset-eu',
      actual_cost: 385.20,
      expected_cost: 84.30,
      deviation_pct: 356.9,
      root_cause: 'Unpartitioned BigQuery full-table scan on raw clickstream analytics dataset scanning 18.4 TB instead of targeted day partition filter in europe-west3.',
      status: 'open'
    },
    {
      date: dateStrSpike1,
      provider: 'AWS',
      service: 'EC2',
      resource_id: 'i-09ab7c12f45ec7',
      actual_cost: 410.50,
      expected_cost: 145.20,
      deviation_pct: 182.7,
      root_cause: 'Unattached EBS volumes (gp3-vol-08492 and gp3-vol-09141) retaining hourly provisioned 12,000 IOPS and 2TB high-performance storage without active EC2 attachment.',
      status: 'resolved',
      resolved_at: new Date(Date.now() - 35 * 86400000).toISOString()
    },
    {
      date: new Date(Date.now() - 15 * 86400000).toISOString().split('T')[0],
      provider: 'AWS',
      service: 'EC2',
      resource_id: 'eipalloc-0174fa90bc',
      actual_cost: 68.40,
      expected_cost: 12.00,
      deviation_pct: 470.0,
      root_cause: 'Unassociated Elastic IPs incurring hourly unattached idle reservation fees across 3 AWS Availability Zones following staging teardown.',
      status: 'resolved',
      resolved_at: new Date(Date.now() - 12 * 86400000).toISOString()
    },
    {
      date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
      provider: 'GCP',
      service: 'GCS',
      resource_id: 'gs://gcp-prod-backups-9122',
      actual_cost: 142.80,
      expected_cost: 48.00,
      deviation_pct: 197.5,
      root_cause: 'Orphaned Google Cloud Storage multi-regional bucket retaining abandoned uncompressed database dumps without lifecycle deletion or nearline transition rules.',
      status: 'open'
    }
  ];

  for (const anom of anomaliesSeed) {
    dbInstance.insertAnomaly(anom);
  }
  console.log(`Seeded ${anomaliesSeed.length} anomaly records.`);

  // Seed Prioritized Cost Optimization Recommendations
  console.log('Seeding Prioritized Cost Optimization Recommendations...');
  const recommendationsSeed = [
    {
      title: 'EC2 to Graviton3 Rightsizing',
      provider: 'AWS',
      category: 'Compute',
      description: 'Migrate 18 legacy c5.2xlarge compute instances to c7g.2xlarge (ARM Neoverse V1) yielding identical throughput with 25% price-performance gain.',
      impact: 'High',
      monthly_savings: 1420.00,
      effort: 'Low',
      status: 'available'
    },
    {
      title: 'S3 Intelligent-Tiering to Glacier Deep Archive',
      provider: 'AWS',
      category: 'Storage',
      description: 'Apply automated lifecycle transitions on bucket prod-data-lake for non-current versions unaccessed for >90 days directly into Glacier Deep Archive.',
      impact: 'Medium',
      monthly_savings: 850.00,
      effort: 'Low',
      status: 'available'
    },
    {
      title: 'Spot VM Batch Migration for Worker Nodes',
      provider: 'GCP',
      category: 'Compute',
      description: 'Convert stateless ETL worker nodepools in GKE cluster gke-etl-pipeline to Spot VMs with grace-period termination drain handlers.',
      impact: 'High',
      monthly_savings: 2180.00,
      effort: 'Medium',
      status: 'available'
    },
    {
      title: 'GCP 3-Year Committed Use Discounts (CUD)',
      provider: 'GCP',
      category: 'Compute',
      description: 'Purchase 3-year resource-based CUD for steady-state backend compute baseline (72 vCPUs, 288GB memory) across us-central1 and europe-west3.',
      impact: 'High',
      monthly_savings: 3450.00,
      effort: 'Low',
      status: 'available'
    },
    {
      title: 'Azure Cosmos DB Autoscale Conversion',
      provider: 'Azure',
      category: 'Database',
      description: 'Switch database account cosmos-account-global from static manual 40,000 RU/s provisioned mode to dynamic Autoscale (4,000 - 40,000 RU/s).',
      impact: 'Medium',
      monthly_savings: 920.00,
      effort: 'Low',
      status: 'available'
    },
    {
      title: 'Unassociated NAT Gateway & Elastic IP Cleanup',
      provider: 'AWS',
      category: 'Networking',
      description: 'Decommission orphaned NAT Gateway in legacy staging VPC and release 4 unattached Elastic IPs incurring idle hourly charges.',
      impact: 'Low',
      monthly_savings: 680.00,
      effort: 'Low',
      status: 'available'
    }
  ];

  for (const rec of recommendationsSeed) {
    dbInstance.insertRecommendation(rec);
  }
  console.log(`Seeded ${recommendationsSeed.length} optimization recommendations.`);

  const kpis = dbInstance.getKPIs();
  console.log('Seeding verification KPIs:', JSON.stringify(kpis, null, 2));
  console.log('--- Database Seeding Complete ---');
}

if (require.main === module) {
  const targetDb = process.argv[2] || path.join(__dirname, 'costs.db');
  seedDatabase(targetDb);
}

module.exports = { seedDatabase };
