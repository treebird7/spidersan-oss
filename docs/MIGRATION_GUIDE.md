# Spidersan Migration Guide: Using Myceliumail

> **Effective Date:** December 2024
> **Change:** Spidersan now uses Myceliumail as its external messaging engine.

## What Changed?

Previously, Spidersan had built-in messaging logic (`src/storage/supabase.ts` messaging methods).
Now, Spidersan commands wrap the standard Myceliumail CLI (`mycmail`).

**Old Architecture:**
```
spidersan send → Internal Code → Supabase
```

**New Architecture:**
```
spidersan send → `mycmail send` → Supabase
```

## For Users

### 1. Install Myceliumail
You must have `mycmail` installed globally or in your project:

```bash
npm install -g myceliumail
```

### 2. Key Management
Keys are now stored in `~/.myceliumail/keys/` instead of `~/.spidersan/keys/`.

**Migration Steps:**
If you have existing keys in `~/.spidersan/keys/*.key.json`, you should:
1.  Run `mycmail keygen` (to generate new keys or initialize the directory)
2.  Or copy your old keyfile:
    ```bash
    cp ~/.spidersan/keys/your-agent.key.json ~/.myceliumail/keys/your-agent.key.json
    ```

### 3. Usage
Spidersan commands remain the same!

```bash
spidersan send mycsan "Hello" --encrypt
spidersan inbox
```

## For Developers

### Environment Variables
Set `MYCELIUMAIL_AGENT_ID` if you use `mycmail` directly.
Spidersan sets this automatically based on `SPIDERSAN_AGENT`.

### Troubleshooting
If you see "mycmail not found":
1.  Run `npm install -g myceliumail`
2.  Ensure `mycmail` is in your PATH

If you see "No keypair found":
1.  Run `spidersan keygen` (which calls `mycmail keygen`)
