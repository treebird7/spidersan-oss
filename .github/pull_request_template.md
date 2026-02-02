# Pull Request

## Summary
<!-- Brief description of changes -->

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Security fix
- [ ] Documentation update

## Related Issues
<!-- Link related issues: Fixes #123, Relates to #456 -->

---

# 🔍 Security Audit Checklist

> **Auditor:** <!-- @agent-name or @username -->  
> **Audit Date:** <!-- YYYY-MM-DD -->

---

## 1. Scope & Meta

- [ ] Repo / service name: 
- [ ] Code areas touched (paths, modules): 
- [ ] Threat model updated or confirmed for this change? (yes/no)

---

## 2. Access Control & Auth

- [ ] All endpoints enforce authorization checks (no unauthenticated sensitive routes)
- [ ] Object-level access checks (no IDOR: users cannot access others' resources by ID)
- [ ] Role/permission checks match documented RBAC (no "admin-by-default")
- [ ] Authentication flows use secure session/token handling (no custom homemade crypto)
- [ ] Branch protection rules active on main branches (PRs required, no direct pushes)

---

## 3. Secrets & Configuration

- [ ] No secrets, keys, or tokens in code, markdown, or git history (scan passed)
- [ ] Environment variables used for secrets; `.env` and similar are git-ignored
- [ ] Short-lived tokens and scoped credentials used for CI/CD and agents
- [ ] Debug / verbose error modes disabled in production configs

---

## 4. Dependencies & Supply Chain

- [ ] `npm audit` / SCA tools run and no unaddressed high/critical issues remain
- [ ] Dependencies pinned with lockfile; no unpinned "latest" in production
- [ ] New packages reviewed (source, popularity, maintenance) before adoption
- [ ] CI builds use `npm ci` (clean reproducible installs)

---

## 5. Input Validation & Injection

- [ ] All external inputs (HTTP, CLI, webhooks, LLM prompts) validated and sanitized server-side
- [ ] No direct string concatenation into SQL/NoSQL queries; use parameterized queries/ORMs
- [ ] No unsanitized data passed into `child_process`, shell commands, or eval-like APIs
- [ ] Templating / rendering escapes user-controlled content to prevent XSS

---

## 6. AI Agents & Orchestration

- [ ] Agent tools are least-privilege; only required commands/endpoints are exposed
- [ ] Sandboxing/isolation configured (container/VM, restricted filesystem, network policies)
- [ ] Prompt injection mitigations in place (input filters, allowlisted instructions, tool gating)
- [ ] All agent actions (filesystem, git, network) are logged with identity and rationale

---

## 7. GitHub & CI/CD Security

- [ ] GitHub Actions workflows restricted to allowed/approved actions
- [ ] Secrets used only via environments with required reviewers where appropriate
- [ ] Workflows avoid `pull_request_target` for untrusted forks and sanitize inputs
- [ ] Security, lint, test, and type-check jobs run and must pass before merge

---

## 8. Node.js / TypeScript Hardening

- [ ] Security headers (via Helmet or equivalent) enabled for HTTP services
- [ ] CORS restricted to trusted origins; no `*` on credentials endpoints
- [ ] Rate limiting / basic DoS protection enabled on public endpoints
- [ ] TypeScript strict mode (or equivalent) enabled to reduce unsafe patterns

---

## 9. Logging, Monitoring, and Errors

- [ ] Logs omit sensitive/PII data but include enough context for forensics
- [ ] Centralized logging and alerts configured for repeated failures or anomalies
- [ ] Errors returned to clients are generic; detailed stack traces only in internal logs

---

## 10. Findings & Actions

- [ ] **Critical issues found:** <!-- List IDs/severity or "None" -->
- [ ] **High/medium issues found:** <!-- List or "None" -->
- [ ] Fixes created as PRs or tickets with owners and due dates
- [ ] Retest plan recorded (what to re-run after fixes)

---

## Testing Done
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing performed

## Screenshots (if applicable)

---

**By submitting this PR, I confirm the security checklist has been reviewed.**
