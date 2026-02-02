---
description: Run a comprehensive security audit on the codebase using the OWASP-based Sherlocksan checklist
---

# Security Audit Workflow

## Overview

Run a structured security audit covering access control, secrets, dependencies, injection vectors, AI agent security, and infrastructure hardening.

## Steps

// turbo
1. **Run automated dependency scan**
   ```bash
   npm audit --audit-level=moderate 2>/dev/null || echo "npm audit not available"
   ```

// turbo
2. **Check for secrets exposure**
   ```bash
   git ls-files | grep -iE '\.env$|secret|\.key$|\.pem$|password|token' || echo "No exposed secret files"
   rg -l 'API_KEY=|SECRET=|PASSWORD=' --type-not gitignore . 2>/dev/null | head -10 || echo "No hardcoded secrets found"
   ```

// turbo
3. **Scan for dangerous patterns**
   ```bash
   rg 'eval\(|new Function\(' --type ts --type js 2>/dev/null | head -10 || echo "No eval patterns"
   rg 'exec\(|execSync\(|spawn\(' --type ts --type js 2>/dev/null | head -10 || echo "No exec patterns"
   rg 'SELECT.*\$\{|INSERT.*\$\{' --type ts 2>/dev/null | head -10 || echo "No SQL injection patterns"
   ```

4. **Review the full checklist**
   Use the PR template checklist at `.github/pull_request_template.md` to verify:
   - Access Control & Auth
   - Secrets & Configuration
   - Dependencies & Supply Chain
   - Input Validation & Injection
   - AI Agents & Orchestration
   - GitHub & CI/CD Security
   - Node.js / TypeScript Hardening
   - Logging, Monitoring, and Errors

5. **Document findings**
   Create an audit report with:
   - Audit scope and date
   - Table of findings with severity
   - Recommended fixes with owners
   - Retest plan

6. **Alert on critical issues**
   If critical findings:
   - Send toaklink message to @freedbird
   - Create P0 invoak task for fix

7. **Log completion**
   Log to daily collab file with summary.

## Severity Guide

| Level | Action | Timeline |
|-------|--------|----------|
| Critical | Block release, fix immediately | Same day |
| High | Fix before merge | 1-2 days |
| Medium | Track as issue | This sprint |
| Low | Nice to have | Backlog |
