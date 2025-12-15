# Treebird Ecosystem - Pricing Strategy

> **DRAFT - Claude Opus 4.5 Suggested Strategy**
>
> This document represents AI-generated pricing recommendations based on industry analysis.
> **NOT CONFIRMED** - Requires founder review and market validation before implementation.
>
> Generated: 2025-12-14

---

## Executive Summary

Recommended model: **Hosted Backend with Flat Pricing**

- Free tier proves value (local storage, unlimited CLI usage)
- Paid tier removes friction (hosted Supabase, zero setup)
- Simple flat pricing (no per-seat, per-repo complexity)

---

## The Treebird Ecosystem

```
┌────────────────────────────────────────────────────────────────┐
│                    TREEBIRD ECOSYSTEM                          │
│                                                                │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │Startersan│  │Mappersan │  │Spidersan │  │Myceliumail│     │
│   │ (entry)  │→ │  (docs)  │→ │(branches)│→ │  (comms)  │     │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                │
│   Bootstrap  →  Document   →  Coordinate  →  Communicate      │
└────────────────────────────────────────────────────────────────┘
```

| Tool | Purpose | Monetization Role |
|------|---------|-------------------|
| **Startersan** | Bootstrap repos | Free forever (acquisition) |
| **Mappersan** | Generate docs | Free CLI, paid watch mode |
| **Spidersan** | Branch coordination | Free local, paid cloud |
| **Myceliumail** | Agent messaging | Free local, paid cloud |

---

## Pricing Tiers

### Free Tier - "Solo Agent"

**Price:** $0 forever

**Target:** Individual developers, hobbyists, evaluation

| Feature | Limit |
|---------|-------|
| Startersan skill | Unlimited |
| Mappersan CLI | Manual runs only |
| Spidersan local storage | 5 concurrent branches |
| Myceliumail local | Single machine only |
| Encryption | Full (keys stored locally) |
| Support | GitHub Issues, community |

**What's NOT included:**
- Cloud sync across machines
- Team coordination
- Message history beyond local
- Watch mode / auto-sync
- Dashboard

---

### Pro Tier - "AI Team"

**Price:** $29/month (flat)

**Target:** Professional developers, small teams, AI-heavy workflows

| Feature | Included |
|---------|----------|
| Everything in Free | ✓ |
| Treebird-hosted backend | Zero Supabase setup |
| Unlimited repos | No per-repo fees |
| Unlimited branches | No caps |
| Unlimited messages | No throttling |
| Cross-machine sync | Work from anywhere |
| Mappersan watch mode | Auto-sync on file change |
| Message history | 90 days |
| Priority support | Email, 48hr response |

**Value proposition:** "Don't want to run Supabase? Don't want limits? $29/mo, everything works."

---

### Team Tier - "Agency"

**Price:** $99/month (flat, up to 10 users)

**Target:** Agencies, dev teams, companies with multiple AI agents

| Feature | Included |
|---------|----------|
| Everything in Pro | ✓ |
| Multi-user dashboard | See all agent activity |
| Team agent registry | Who's working on what |
| Broadcast messaging | Announce to all agents |
| Conflict analytics | Branch overlap reports |
| Rescue mode dashboard | Visual triage interface |
| Role-based access | Admin, developer, viewer |
| Message history | 1 year |
| Priority support | Email, 24hr response |
| Additional users | +$10/user beyond 10 |

**Value proposition:** "Your whole team's AI agents, coordinated in one dashboard."

---

### Enterprise Tier - "Platform"

**Price:** Custom (starting ~$500/month)

**Target:** Large organizations, compliance-required environments

| Feature | Included |
|---------|----------|
| Everything in Team | ✓ |
| Self-hosted option | Run on your infrastructure |
| SSO/SAML | Enterprise auth |
| Audit logs | Full activity tracking |
| Data residency | Choose region |
| SLA | 99.9% uptime guarantee |
| Dedicated support | Private Slack channel |
| Custom integrations | API access, webhooks |
| Onboarding | White-glove setup |
| Invoice billing | NET 30, PO support |

**Value proposition:** "Enterprise-grade AI agent coordination with compliance and support."

---

## Feature Matrix

| Feature | Free | Pro ($29) | Team ($99) | Enterprise |
|---------|------|-----------|------------|------------|
| Startersan | ✓ | ✓ | ✓ | ✓ |
| Mappersan CLI | ✓ | ✓ | ✓ | ✓ |
| Mappersan watch | - | ✓ | ✓ | ✓ |
| Spidersan local | 5 branches | ✓ | ✓ | ✓ |
| Spidersan cloud | - | Unlimited | Unlimited | Unlimited |
| Myceliumail local | ✓ | ✓ | ✓ | ✓ |
| Myceliumail cloud | - | ✓ | ✓ | ✓ |
| Encryption | ✓ | ✓ | ✓ | ✓ |
| Cross-machine sync | - | ✓ | ✓ | ✓ |
| Dashboard | - | - | ✓ | ✓ |
| Analytics | - | - | ✓ | ✓ |
| Team management | - | - | ✓ | ✓ |
| Self-hosted | - | - | - | ✓ |
| SSO/SAML | - | - | - | ✓ |
| SLA | - | - | - | ✓ |
| Support | Community | Email 48hr | Email 24hr | Dedicated |

---

## Why This Model

### Why Flat Pricing (Not Per-Seat/Per-Repo)?

1. **AI agents blur "seats"** - Is Claude Code a seat? What about Cursor? Per-seat doesn't map well.

2. **Per-repo creates friction** - "Should I add this repo?" becomes a billing decision instead of a workflow decision.

3. **Flat = predictable** - Developers hate surprise bills. $29 is $29.

4. **Encourages adoption** - Use it everywhere, no mental accounting.

### Why Hosted Backend?

1. **Supabase setup is friction** - Many devs won't bother.

2. **"It just works" is worth money** - Add API key, done.

3. **Recurring revenue** - You provide ongoing value (hosting), they pay ongoing fee.

4. **Differentiator** - Self-hosters stay free, convenience-seekers pay.

### Why Free Tier is Generous?

1. **Proves value before paywall** - Local storage shows the tool works.

2. **Drives word-of-mouth** - Free users recommend to paying teams.

3. **Startersan as funnel** - Free skill → Mappersan → Spidersan → paid.

---

## Revenue Projections (Hypothetical)

### Year 1 Targets

| Metric | Target |
|--------|--------|
| Free users | 1,000 |
| Pro conversions (3%) | 30 |
| Team conversions | 5 |
| Monthly revenue | $1,365 |
| Annual revenue | ~$16,000 |

### Year 2 Targets (with growth)

| Metric | Target |
|--------|--------|
| Free users | 10,000 |
| Pro conversions (3%) | 300 |
| Team conversions | 30 |
| Enterprise deals | 2 |
| Monthly revenue | $12,700 |
| Annual revenue | ~$150,000 |

*These are illustrative estimates, not forecasts.*

---

## Go-To-Market Strategy

### Phase 1: Adoption (Months 1-6)
- Ship all tools as MIT licensed
- Free tier only
- Focus on GitHub stars, npm downloads
- Content marketing (blog posts, tutorials)
- No paid tier yet (build community first)

### Phase 2: Monetization (Months 6-12)
- Launch hosted backend
- Introduce Pro tier
- Grandfather early adopters with discount
- Case studies from free users

### Phase 3: Scale (Year 2)
- Launch Team tier with dashboard
- Enterprise sales (outbound)
- Integrations (VS Code, JetBrains)
- Partner with AI coding tool companies

---

## Competitive Positioning

### vs. "Just use Git"
"Git doesn't know what AI agents are doing until it's too late. Spidersan coordinates BEFORE conflicts happen."

### vs. Google A2A Protocol
"A2A is a protocol spec. Myceliumail is a working CLI you can install in 30 seconds."

### vs. Manual Documentation
"Mappersan keeps your CLAUDE.md accurate automatically. No more stale docs."

### vs. DIY Supabase
"You COULD set up Supabase yourself. Or pay $29/mo and never think about it."

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Low conversion rate | Make paid features genuinely valuable (not artificial limits) |
| Competitors copy | Move fast, build community, brand loyalty |
| Supabase costs exceed revenue | Monitor unit economics, adjust pricing |
| Enterprise sales slow | Focus on self-serve Pro tier first |
| Free tier abused | Rate limiting, fair use policy |

---

## Open Questions

1. **Annual discount?** (e.g., $290/year = 2 months free)

2. **Student/OSS discount?** (50% off for students, free for OSS maintainers?)

3. **Lifetime deal?** (One-time $500 for lifetime Pro? Good for launch buzz, risky long-term)

4. **Usage limits on Pro?** (Currently "unlimited" - sustainable?)

5. **Self-hosted Pro?** (Pay for software, host yourself? Or cloud-only?)

6. **Bundled vs. separate?** (One price for ecosystem, or per-tool pricing?)

---

## Next Steps

1. [ ] Founder review of pricing tiers
2. [ ] Validate with potential customers (5-10 interviews)
3. [ ] Calculate Supabase hosting costs per user
4. [ ] Design pricing page
5. [ ] Build billing integration (Stripe?)
6. [ ] Write terms of service
7. [ ] Launch free tier first, paid later

---

## Appendix: Alternative Models Considered

### Per-Repo Pricing (Rejected)
```
Free: 1 repo
Pro: $15/mo per repo
```
**Why rejected:** Creates friction. Users hesitate to add repos.

### Per-Seat Pricing (Rejected)
```
Free: 1 seat
Pro: $20/mo per seat
```
**Why rejected:** "Seat" doesn't map to AI agents. Confusing.

### Usage-Based (Rejected)
```
Free: 100 messages/mo
Pro: $0.01 per message
```
**Why rejected:** Unpredictable bills. Developers hate this.

### Sponsorware (Considered)
```
Sponsors get early access to features
Public release after funding goal
```
**Status:** Could work alongside main model for specific features.

### Open Core with Proprietary Dashboard (Considered)
```
CLI: MIT licensed
Dashboard: Proprietary, paid only
```
**Status:** Viable. Dashboard could be the paid differentiator.

---

> **Reminder:** This is a draft strategy document generated by Claude Opus 4.5.
> All pricing, projections, and recommendations require validation before implementation.
