# Erooka - Solar Work Order Mapping System

A production-ready, serverless solar work order mapping system built with AWS Lambda, DynamoDB, and Next.js.

## 🎯 Project Overview

**Erooka** is a complete serverless application for managing solar power plants, vendors, alerts, work orders, and weather monitoring data. Built from scratch with modern best practices, SOLID principles, and comprehensive test coverage.

## 📊 System Scale

- **Plants**: Maximum 7,000 plants
- **Alerts**: ~35,000 alerts/day (~1M alerts/month)
- **Concurrent Users**: Maximum 30 users
- **Long-running Tasks**: Maximum 2 minutes (sync jobs)
- **Test Coverage**: >90% (integration tests)

## 🏗️ Architecture

### Backend (Serverless)
- **API**: AWS API Gateway REST API
- **Compute**: AWS Lambda (Node.js 20.x)
- **Database**: Amazon DynamoDB (3 tables with optimized GSIs)
- **Scheduling**: AWS EventBridge (cron jobs)
- **Infrastructure**: Terraform (IaC)

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Styling**: TailwindCSS
- **Components**: shadcn/ui (Radix UI)
- **Animations**: Framer Motion (full animations)
- **Charts**: Recharts
- **Deployment**: Cloudflare Pages (FREE)

## 💰 Cost Optimization

**Estimated Monthly Cost: $5-15/month** (mostly within AWS free tiers)

| Service | Cost |
|---------|------|
| DynamoDB | $0-5 (free tier) |
| Lambda | $0-2 (free tier) |
| API Gateway | $0 (free tier) |
| EventBridge | $0 (free tier) |
| CloudWatch | $0-3 |
| Cloudflare Pages | $0 (FREE) |
| **Total** | **$5-15/month** |

## 📁 Project Structure

```
erooka/
├── infrastructure/          # Terraform IaC
├── src/                     # Source code
│   ├── domain/             # Domain models
│   ├── application/         # Application services
│   ├── infrastructure/      # Infrastructure layer
│   └── interfaces/         # API handlers
├── tests/                   # Test suite
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   ├── e2e/                # E2E tests
│   └── features/           # Cucumber features
├── frontend/                # Next.js frontend
└── docs/                    # Documentation
```

## 🧪 Testing Strategy

- **TDD Approach**: Write tests first, then implementation
- **Test Coverage**: >90% (integration tests)
- **Testing Frameworks**:
  - Unit: Jest
  - Integration: Jest + DynamoDB Local
  - E2E: Playwright
  - BDD: Cucumber (Gherkin)

## 🚀 Getting Started

### Prerequisites

- Node.js 20.x
- Terraform 1.5+
- AWS CLI configured
- Docker (for DynamoDB Local)

### Setup

1. **Clone and install dependencies**:
   ```bash
   cd erooka
   npm install
   ```

2. **Set up AWS credentials**:
   ```bash
   aws configure
   ```

3. **Deploy infrastructure**:
   ```bash
   cd infrastructure
   terraform init
   terraform plan
   terraform apply
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

5. **Start development**:
   ```bash
   cd frontend
   npm run dev
   ```

## 📚 Documentation

All documentation is organized in the `docs/` directory:

- [Architecture Design](./docs/ARCHITECTURE_DESIGN.md) - Complete architecture documentation
- [API Pseudo-Code](./docs/API_PSEUDOCODE.md) - Complete API pseudo-code and DynamoDB query patterns
- [Implementation Checklist](./docs/IMPLEMENTATION_CHECKLIST.md) - Feature implementation tracker
- [DynamoDB Schema Analysis](./docs/DYNAMODB_SCHEMA_ANALYSIS.md) - Detailed schema design rationale
- [Production Metrics Design](./docs/PRODUCTION_METRICS_DESIGN.md) - Production metrics aggregation strategy
- [Dashboard Metrics Design](./docs/DASHBOARD_METRICS_DESIGN.md) - Dashboard-level metrics aggregation

## 🎨 Features

### Core Features
- ✅ Authentication & Authorization (RBAC)
- ✅ Organization Management
- ✅ Vendor Management (Multi-vendor adapter system)
- ✅ Plant Management (7,000 plants max)
- ✅ Alert Management (35K alerts/day)
- ✅ Work Order Management
- ✅ WMS (Weather Monitoring System)
- ✅ Analytics & Reporting
- ✅ Dashboard (Role-adaptive)

### Technical Features
- ✅ Serverless Architecture (100% AWS)
- ✅ DynamoDB (Optimized schema with GSIs)
- ✅ TDD with >90% test coverage
- ✅ SOLID Principles
- ✅ Modular Code Structure
- ✅ Comprehensive Error Handling
- ✅ Structured Logging
- ✅ Cost-Optimized Design

## 🔒 Security

- HTTP-only cookies for session management
- RBAC (Role-Based Access Control)
- AWS Secrets Manager for sensitive data
- DynamoDB encryption at rest
- API Gateway throttling and CORS

## 📈 Monitoring

- CloudWatch Logs (structured JSON logging)
- CloudWatch Metrics (custom business KPIs)
- CloudWatch Alarms (error and latency monitoring)

## 🤝 Contributing

1. Follow TDD approach (write tests first)
2. Ensure >90% test coverage
3. Follow SOLID principles
4. Update implementation checklist
5. Write comprehensive documentation

## 📝 License

MIT License

---

**Built with ❤️ for solar energy management**

