# Cloud Cost Optimization & FinOps Analytics Platform

A production-grade, multi-cloud cost intelligence and governance platform built from scratch with zero heavy database overhead. Powered natively by **Node.js v22 built-in SQLite engine (`node:sqlite`)**, **Tailwind CSS**, **Lucide Icons**, and **Chart.js**.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph MultiCloud ["Multi-Cloud Ingestion Layer"]
        AWS["AWS (EC2, S3, RDS, NAT Gateway, Lambda)"]
        GCP["GCP (Compute Engine, BigQuery, GCS, Cloud Run)"]
        Azure["Azure (VMs, Blob Storage, Cosmos DB, Functions)"]
    end

    subgraph CoreEngine ["High-Performance Platform Engine"]
        IngestAPI["Billing Ingestion API (/api/ingest)"]
        DB[(costs.db - Node.js v22 SQLite)]
        AnomalyEngine["Statistical Anomaly Detector (>30% Rolling 14d Mean)"]
        ROIModel["Dynamic ROI & Savings Realization Engine"]
    end

    subgraph ExecutiveUI ["Executive FinOps Dashboard"]
        KPIs["4 Executive KPI Cards (Spend, Burn, 30d Projection, Savings)"]
        AreaChart["Daily Multi-Cloud Spend Velocity (30d/60d/90d/180d)"]
        DonutChart["Provider Allocation Split (AWS vs GCP vs Azure)"]
        BarChart["Top 6 Cost Drivers"]
        CategoryBars["Category Allocation Bars (5 Domains)"]
        AnomalyCenter["Anomaly Detection Center & Orphaned Resource Resolver"]
        ActionHub["Prioritized Rightsizing & Savings Action Hub"]
        ExportHub["1-Click CSV & JSON Audit Exporters"]
    end

    AWS --> IngestAPI
    GCP --> IngestAPI
    Azure --> IngestAPI
    IngestAPI --> DB
    DB --> AnomalyEngine
    DB --> ROIModel
    DB --> KPIs
    DB --> AreaChart
    DB --> DonutChart
    DB --> BarChart
    DB --> CategoryBars
    AnomalyEngine --> AnomalyCenter
    ROIModel --> ActionHub
    ROIModel --> KPIs
    DB --> ExportHub
```

---

## Key Capabilities

### 1. Multi-Cloud Billing Ingestion & Data Model
- Standardized data schema normalizing heterogeneous telemetry across **AWS**, **GCP**, and **Azure**.
- Pre-seeded with **5,764+ daily billing records** spanning **180 days (6 months)** with realistic:
  - **Seasonal Growth**: ~25% organic infrastructure expansion over 6 months.
  - **Weekend Dips**: -27.2% reduction in compute, database, and networking usage over weekends.
  - **Regional Cost Variances**: Real-world price deltas across `us-east-1`, `eu-central-1`, `ap-southeast-1`, `us-central1`, `westeurope`, etc.

### 2. Executive FinOps Dashboard
- **4 Real-Time KPI Summary Cards**:
  1. **Total Spend**: Currency-formatted multi-cloud expenditure with period-over-period trend badge.
  2. **Daily Burn Rate**: 7-day velocity metric calculating current daily cash consumption.
  3. **30-Day Cost Projection**: Predictive forecast dynamically discounted by realized optimization savings.
  4. **Real-Time Savings Tracker**: Live count-up tracker aggregating active optimization ROI.
- **Interactive Visualizations**:
  - **Daily Spend Area Chart**: Interactive date filters (`30d`, `60d`, `90d`, `180d`) with smooth Bezier curve and vendor gradients.
  - **Provider Spend Split Donut Chart**: Breakdown and percentage allocation across AWS, GCP, and Azure.
  - **Top 6 Cost-Driving Services**: Horizontal bar chart identifying highest spend resources.
  - **Category Progress Bars**: Five architectural tiers (Compute, Storage, Database, Networking, Serverless).

### 3. Statistical Anomaly Detection Center
- Flags daily service spikes deviating **>30% from the 14-day rolling mean baseline**.
- Built-in root-cause diagnostics identifying orphaned infrastructure:
  - Unattached EBS gp3 volumes retaining provisioned IOPS without active EC2 attachments.
  - Unassociated Elastic IPs incurring idle hourly charges.
  - Unpartitioned BigQuery full-table scans scanning raw clickstream data.
  - Overprovisioned manual Cosmos DB Request Units (RU/s).
  - NAT Gateway routing loop in VPC staging.
- Interactive status toggles (`Mark as Resolved` / `Reopen`) with persistent state synchronization.

### 4. Cost Optimization & Action Hub
- Prioritized savings recommendations (Graviton3 rightsizing, S3 Intelligent-Tiering to Glacier Deep Archive, Spot VM batch conversion, Committed Use Discounts, Cosmos DB Autoscale).
- Interactive **"Apply Action"** buttons updating SQLite in real-time, instantly lowering 30-day projected spend and raising realized ROI.

### 5. Audit Export Hub
- **1-Click CSV Download**: Full RFC 4180 audit report covering all ingested multi-cloud telemetry.
- **1-Click JSON Download**: Executive FinOps audit specification containing metadata, KPIs, provider distributions, open anomalies, and applied recommendations.

---

## Quickstart & Verification

### Prerequisites
- Node.js v22+
- Git

### Installation & Test Suite Execution
```bash
# Clone and enter directory
cd finops-platform

# Install dependencies
npm install

# Run automated test suite (100% success rate across 21 test specs)
npm test

# Run database seeder
npm run seed

# Start production server
npm start
```
The dashboard is accessible immediately at **http://localhost:3000**.

---

## Quality Assurance & Automated Test Results

The platform includes an automated test suite (`test.js`) covering 8 comprehensive testing suites:
1. **Database Schema & Table Initialization**
2. **Record Volumes & Temporal Span (5,764 records / 180 days)**
3. **Multi-Cloud Vendor & Service Coverage**
4. **Behavioral Patterns: Seasonal Ramp & -27.2% Weekend Dip Verification**
5. **Statistical Anomaly Detection (>30% rolling mean baseline) & Root-Cause Resolution**
6. **Cost Optimization & Dynamic Real-Time ROI Recalculation**
7. **CSV & JSON Report Integrity**
8. **Express REST API Endpoints Verification**

```
======================================================
  ALL TEST SUITES PASSED: 21 / 21 (100% Success Rate)
======================================================
```

---

## Containerization & Cloud Deployment

### Docker Containerization
```bash
# Build production Docker image
docker build -t finops-cloud-platform .

# Run container
docker run -d -p 3000:3000 --name finops-app finops-cloud-platform

# Or deploy with Docker Compose
docker-compose up -d
```

### Vercel Cloud Deployment
```bash
# Authenticate and deploy to Vercel production
npx vercel --prod --yes
```

---

## Linking to GitHub

To push this repository to GitHub:
```bash
git remote add origin <GITHUB_REPO_URL>
git branch -M main
git push -u origin main
```

---

## 3-Point Viva / Presentation Summary

1. **Architecture & Zero-Overhead Engine**: Built using high-performance Node.js v22 featuring native `node:sqlite`, eliminating heavy MySQL/PostgreSQL dependencies while delivering sub-millisecond query responses across 5,700+ billing telemetry records.
2. **Algorithmic Anomaly Detection & Orphaned Resource Diagnostics**: Leverages a 14-day rolling mean statistical deviation model to instantly flag cloud spend surges exceeding 30%, pairing each incident with specific root-cause identifiers (unattached EBS volumes, unassociated Elastic IPs, unpartitioned BigQuery scans).
3. **Actionable FinOps ROI Loop**: Bridges analytics with actionable execution through interactive cost optimization recommendations—applying rightsizing actions immediately updates persistent database state, dynamically recalibrates daily burn velocity, and credits realized ROI on the executive dashboard.
