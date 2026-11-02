---
tags: [agent/spidersan]
---

# Why You Need Spidersan

## The Problem

You're using AI coding assistants (Claude, Cursor, Windsurf) to write code faster. Great!

But then you run **two sessions at once**. Or three. Each working on different features.

And when you try to merge everything back together...

**💥 MERGE HELL 💥**

- Branch A changed the same file as Branch B
- Nobody knew what anyone else was working on
- You spend 2 hours fixing conflicts instead of shipping features

---

## The Solution: Spidersan 🕷️

Spidersan is like **air traffic control for your AI coding sessions**.

Before: AI sessions crash into each other
After: AI sessions coordinate automatically

---

## How It Works (30 seconds)

**1. Register your branch**
```bash
spidersan register "Adding user authentication"
```

**2. Check for conflicts before they happen**
```bash
spidersan conflicts
```
> ⚠️ Conflict with branch 'feature-dark-mode' on: auth.ts

**3. Get the right merge order**
```bash
spidersan merge-order
```
> 1. feature-dark-mode (no conflicts)
> 2. feature-auth (conflicts with #1, merge second)

---

## Who Is This For?

✅ **You're using multiple AI coding sessions** (Claude, Cursor, Windsurf)  
✅ **You work on a team** with parallel feature work  
✅ **You've lost hours** to merge conflicts  
✅ **You want to move fast** without breaking things

---

## What You Get

### Free Tier (Forever Free)
- Branch registration
- Conflict detection
- Merge order recommendations
- Ready-to-merge validation
- Local storage

### Optional Cloud Sync
- Cross-machine sync through a pluggable sync module (opt-in)
- Team coordination (shared registry)
- Agent-to-agent messaging (via Myceliumail)

---

## The Bottom Line

**Without Spidersan:** AI writes code fast, but you lose time merging

**With Spidersan:** AI writes code fast, AND merges are smooth

---

## Get Started

```bash
npm install -g spidersan
spidersan init
spidersan register "My first feature"
```

That's it. 30 seconds to never fear merge conflicts again.

🕷️ **Stop the merge chaos.**
