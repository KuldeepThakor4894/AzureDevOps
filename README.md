# Azure DevOps Intelligence Hub ⚡

> **Unified Enterprise Repository Matrix, Branch Policy Compliance, CI/CD Telemetry & Security Analysis**

An authentic **Microsoft Azure Portal-themed** single-page intelligence platform engineered to inspect, audit, and visualize Azure DevOps organizations and projects with the **"Blade & Canvas"** layout architecture.

![Azure Theme](https://img.shields.io/badge/Theme-Microsoft%20Azure%20Portal-0078d4?style=flat&logo=microsoftazure)
![DevOps](https://img.shields.io/badge/Platform-Azure%20DevOps-005a9e?style=flat&logo=azuredevops)
![Architecture](https://img.shields.io/badge/Architecture-Blade%20%26%20Canvas-107c10?style=flat)

---

## 🌟 Key Features

- 🏛️ **Executive Presentation & Azure Dark Themes**: 1-click switcher between **Executive Bright Mode** (high-contrast for stakeholder presentations) and **Azure Portal Dark Canvas Mode**.
- 🛡️ **Project Security Groups & Permissions Graph**: Audit all project security groups, inherited rights, descriptors, and member identities.
- 🌿 **Branch Policies & Health Matrix**: Verify branch protection policies (minimum reviewer counts, build validations, comment resolution, merge strategies) and flag stale branches (>90 days).
- 📊 **Unified Build & Release Pipeline Delivery**: Monitor every build along with its linked **Release Pipeline deployments** (Dev, QA, Staging, Production). Instantly determine whether both the build and release environments have succeeded, are in progress, or require action.
- 🗂️ **Interactive Azure Blades**: Click any pipeline run, branch policy, commit, work item, agent pool, or service connection to slide in a deep telemetry blade from the right with visual stage topology graphs, capability matrices, and diagnostic logs.
- 📋 **Active Work Items & Backlog**: Query work items with integrated WIQL engine and type distribution charts.
- ⚙️ **Project Agent Pools & Queues**: Inspect project-wise task agent queues, Azure-hosted runners vs self-hosted agents, real-time online/offline statuses, running jobs, version details, and system capability matrices.
- 🔗 **Project Service Connections & Endpoints**: Audit project service endpoints across Azure Resource Manager (ARM), GitHub, Docker Registry, Kubernetes, and SonarQube, with authorization verification (Workload Identity Federation / OIDC vs Service Principal) and telemetry inspection.
- 📥 **Enterprise Export**: Export permissions to `.xlsx` and active table views to `.csv`.

---

## 🚀 Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/KuldeepThakor4894/AZDO_Insights.git
   cd AZDO_Insights
   ```

2. **Run locally**:
   - **PowerShell**:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\server.ps1
     ```
   - **Or open directly**: Open `index.html` in any modern web browser.

3. **Authenticate**:
   - Enter your **Azure DevOps Organization Name** (e.g. `MyOrg` or `https://dev.azure.com/MyOrg`).
   - Enter a **Personal Access Token (PAT)** with `Code (Read)`, `Build (Read)`, `Graph (Read)`, and `Work Items (Read)` scopes.

---

## 🎨 Design System

- **Master Canvas**: Deep Azure Space (`#0b121c`) or Executive Bright (`#f0f4f9`).
- **Surface Panels**: Frosted card layers with crisp 1px borders (`#283648` / `#dbe4ee`).
- **Brand Colors**: Microsoft Azure Blue (`#0078d4`), Emerald Green (`#107c10`), Crimson Red (`#d13438`), Vivid Amber (`#ea580c`), Royal Purple (`#7c3aed`).
- **Iconography**: Minimalist Azure Architecture & DevOps outline SVG glyphs.

---

## 📄 License
MIT License
