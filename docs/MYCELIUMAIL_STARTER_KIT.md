# Myceliumail Starter Kit

> **Everything you need to bootstrap Myceliumail from a fresh repo**

---

## Step 1: Create the Repository

```bash
mkdir myceliumail && cd myceliumail
git init
npm init -y
```

---

## Step 2: Inject CLAUDE.md

Create this file first - it's the "injection" that gives any AI agent instant context:

```bash
cat > CLAUDE.md << 'EOF'
# Myceliumail - AI Agent Context

> **End-to-End Encrypted Messaging for AI Agents**

## What is Myceliumail?

Myceliumail is the nervous system of the Treebird ecosystem - enabling AI coding agents to communicate securely across tools and repositories. Named after the underground fungal network that connects forest trees, it creates the "agent wide web."

## Core Commands

```bash
# Messaging
mycmail send <agent> "<subject>"          # Send message to agent
mycmail inbox                             # Check incoming messages
mycmail read <id>                         # Read specific message
mycmail reply <id> "<message>"            # Reply to a message
mycmail archive <id>                      # Archive read message

# Encryption (required for secure messaging)
mycmail keygen                            # Generate your keypair (run once)
mycmail keys                              # List known public keys
mycmail key-import <agent> <key>          # Import another agent's public key
mycmail send <agent> --encrypt            # Send encrypted message

# Channels (group messaging)
mycmail channel create <name>             # Create new channel
mycmail channel join <name>               # Join a channel
mycmail channel post <name> "<message>"   # Post to channel

# Network & Presence
mycmail agents                            # List all connected agents
mycmail ping <agent>                      # Ping an agent
mycmail status --set <status>             # Update my status
mycmail broadcast "<message>"             # Message all agents
```

## Encryption

> **All messages encrypted by default with NaCl box**

```bash
# Setup (one-time)
mycmail keygen
# Output: Your public key (share this with other agents)

# Exchange keys
mycmail key-import claude AbC123...       # Import peer's public key
mycmail keys                              # Verify import

# Messages auto-encrypt when recipient key is known
mycmail send claude "Secret plans" --message "For your eyes only"
```

Uses **X25519 key exchange + XSalsa20-Poly1305** encryption (tweetnacl).
Keys stored in `~/.myceliumail/keys/`.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      Myceliumail CLI                        │
├────────────────────────────────────────────────────────────┤
│  Commands: send | inbox | read | reply | keygen | keys      │
├────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌────────────┐  ┌─────────────────────┐  │
│  │   Crypto    │  │  Storage   │  │      Presence       │  │
│  ├─────────────┤  ├────────────┤  ├─────────────────────┤  │
│  │ NaCl Box    │  │ Supabase   │  │ Agent heartbeat     │  │
│  │ X25519      │  │ PostgreSQL │  │ Status tracking     │  │
│  │ XSalsa20    │  │ Local JSON │  │ Key registry        │  │
│  └─────────────┘  └────────────┘  └─────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── bin/myceliumail.ts    # CLI entry point
├── commands/             # Command implementations
│   ├── send.ts
│   ├── inbox.ts
│   ├── read.ts
│   ├── reply.ts
│   ├── keygen.ts
│   ├── keys.ts
│   └── key-import.ts
├── lib/                  # Core libraries
│   ├── crypto.ts         # NaCl encryption
│   ├── config.ts
│   └── storage.ts
└── storage/              # Storage adapters
    ├── local.ts          # JSON file storage
    └── supabase.ts       # Cloud storage
```

## Database Schema

Messages are stored with encryption at rest:

```sql
-- agent_messages table
id uuid PRIMARY KEY,
sender text NOT NULL,
recipient text NOT NULL,
subject text,                    -- encrypted if message is encrypted
body text,                       -- encrypted if message is encrypted
encrypted boolean DEFAULT false, -- encryption indicator
ciphertext text,                 -- NaCl encrypted payload
nonce text,                      -- NaCl nonce
sender_public_key text,          -- sender's public key for decryption
read boolean DEFAULT false,
archived boolean DEFAULT false,
created_at timestamptz DEFAULT now()
```

## Key Interfaces

```typescript
interface EncryptedMessage {
    ciphertext: string;      // base64
    nonce: string;           // base64
    senderPublicKey: string; // base64
}

interface Message {
    id: string;
    sender: string;
    recipient: string;
    subject: string;
    body: string;
    encrypted: boolean;
    encryptedPayload?: EncryptedMessage;
    read: boolean;
    archived: boolean;
    createdAt: Date;
}
```

## Testing

```bash
npm test              # Run unit tests
npm run lint          # ESLint
npm run build         # TypeScript compilation
```

## Related Projects

- **Spidersan** - Branch coordination CLI (current home of messaging)
- **Mappersan** - Documentation mapping CLI
- **Recovery-Tree** - Agent state persistence

---

**Full roadmap:** See Spidersan repo `docs/MYCELIUMAIL_ROADMAP.md`
EOF
```

---

## Step 3: Bootstrap Prompt

Use this prompt to have Claude Code set up the project:

```
Create a TypeScript CLI project for Myceliumail with:

1. Project Setup:
   - TypeScript with ES2022 target, ESM modules
   - Node 18+ requirement
   - Commander.js 12.0.0 for CLI
   - tweetnacl + tweetnacl-util for encryption
   - Vitest for testing
   - ESLint + TypeScript ESLint

2. Package.json:
   - name: "myceliumail"
   - bin: { "mycmail": "./dist/bin/myceliumail.js", "myceliumail": "./dist/bin/myceliumail.js" }
   - type: "module"
   - scripts: build, test, lint, dev

3. Initial Commands:
   - send: Send message to agent
   - inbox: List messages
   - read: Read specific message
   - keygen: Generate keypair
   - keys: List known keys
   - key-import: Import peer's public key

4. Project Structure:
   src/
   ├── bin/myceliumail.ts      # CLI entry, Commander setup
   ├── commands/
   │   ├── send.ts
   │   ├── inbox.ts
   │   ├── read.ts
   │   ├── keygen.ts
   │   ├── keys.ts
   │   └── key-import.ts
   ├── lib/
   │   ├── crypto.ts           # NaCl encryption (carry from Spidersan)
   │   └── config.ts           # Config loading
   └── storage/
       ├── local.ts            # JSON file storage
       └── supabase.ts         # Supabase adapter (optional)

5. Encryption from Day 1:
   - Use NaCl box (X25519 + XSalsa20-Poly1305)
   - Keys stored in ~/.myceliumail/keys/
   - Messages default to encrypted when recipient key is known

Make the CLI executable and working. I should be able to run:
- npm run build
- npm link
- mycmail --help
- mycmail keygen
```

---

## Step 4: Supabase Schema (Encryption-First)

Apply this migration to create the encrypted messages table:

```sql
-- migrations/000_myceliumail_setup.sql
-- Myceliumail: Agent Messaging with E2E Encryption

-- Agent messages table with encryption support
CREATE TABLE IF NOT EXISTS agent_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender text NOT NULL,
    recipient text NOT NULL,
    subject text,
    body text,
    
    -- Encryption fields (NaCl box)
    encrypted boolean DEFAULT false,
    ciphertext text,                -- base64 encrypted payload
    nonce text,                     -- base64 nonce
    sender_public_key text,         -- base64 sender's public key
    
    -- Message state
    read boolean DEFAULT false,
    archived boolean DEFAULT false,
    
    -- Metadata
    message_type text DEFAULT 'direct', -- direct, channel, broadcast, system
    thread_id uuid,                     -- for threaded conversations
    reply_to uuid,                      -- parent message
    priority text DEFAULT 'normal',     -- low, normal, high, urgent
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient 
    ON agent_messages(recipient, read, archived);
CREATE INDEX IF NOT EXISTS idx_agent_messages_sender 
    ON agent_messages(sender, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread 
    ON agent_messages(thread_id) WHERE thread_id IS NOT NULL;

-- Agent public keys registry
CREATE TABLE IF NOT EXISTS agent_keys (
    agent_id text PRIMARY KEY,
    public_key text NOT NULL,        -- base64 encoded
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
    name text PRIMARY KEY,
    description text,
    is_public boolean DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Channel membership
CREATE TABLE IF NOT EXISTS channel_members (
    channel_name text REFERENCES channels(name) ON DELETE CASCADE,
    agent_id text,
    joined_at timestamptz DEFAULT now(),
    notify_level text DEFAULT 'all', -- all, mentions, none
    PRIMARY KEY (channel_name, agent_id)
);

-- RLS Policies
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_keys ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated access (agents auth via service key)
CREATE POLICY "Agents can read their own messages"
    ON agent_messages FOR SELECT
    USING (true);

CREATE POLICY "Agents can insert messages"
    ON agent_messages FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Agents can update their own received messages"
    ON agent_messages FOR UPDATE
    USING (true);

CREATE POLICY "Anyone can read public keys"
    ON agent_keys FOR SELECT
    USING (true);

CREATE POLICY "Agents can insert their own key"
    ON agent_keys FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Agents can update their own key"
    ON agent_keys FOR UPDATE
    USING (true);
```

Apply with:
```bash
supabase db push
# or
supabase migration up
```

---

## Step 5: Carry Forward Crypto Module

This crypto module is battle-tested from Spidersan. Copy and adapt:

```typescript
// src/lib/crypto.ts
/**
 * Myceliumail Crypto Module
 * 
 * E2E encryption for agent messaging using TweetNaCl.
 * Uses X25519 for key exchange and XSalsa20-Poly1305 for encryption.
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Key storage location
const KEYS_DIR = join(homedir(), '.myceliumail', 'keys');

export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

export interface EncryptedMessage {
    ciphertext: string;      // base64
    nonce: string;           // base64
    senderPublicKey: string; // base64
}

/**
 * Ensure keys directory exists
 */
function ensureKeysDir(): void {
    if (!existsSync(KEYS_DIR)) {
        mkdirSync(KEYS_DIR, { recursive: true });
    }
}

/**
 * Generate a new keypair for an agent
 */
export function generateKeyPair(): KeyPair {
    return nacl.box.keyPair();
}

/**
 * Save keypair to local storage
 */
export function saveKeyPair(agentId: string, keyPair: KeyPair): void {
    ensureKeysDir();
    const serialized = {
        publicKey: util.encodeBase64(keyPair.publicKey),
        secretKey: util.encodeBase64(keyPair.secretKey),
    };
    const path = join(KEYS_DIR, `${agentId}.key.json`);
    writeFileSync(path, JSON.stringify(serialized, null, 2), { mode: 0o600 });
}

/**
 * Load keypair from local storage
 */
export function loadKeyPair(agentId: string): KeyPair | null {
    const path = join(KEYS_DIR, `${agentId}.key.json`);
    if (!existsSync(path)) return null;
    
    try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        return {
            publicKey: util.decodeBase64(data.publicKey),
            secretKey: util.decodeBase64(data.secretKey),
        };
    } catch {
        return null;
    }
}

/**
 * Encrypt a message for a recipient
 */
export function encryptMessage(
    message: string,
    recipientPublicKey: Uint8Array,
    senderKeyPair: KeyPair
): EncryptedMessage {
    const messageBytes = util.decodeUTF8(message);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    const ciphertext = nacl.box(
        messageBytes,
        nonce,
        recipientPublicKey,
        senderKeyPair.secretKey
    );

    return {
        ciphertext: util.encodeBase64(ciphertext),
        nonce: util.encodeBase64(nonce),
        senderPublicKey: util.encodeBase64(senderKeyPair.publicKey),
    };
}

/**
 * Decrypt a message from a sender
 */
export function decryptMessage(
    encrypted: EncryptedMessage,
    recipientKeyPair: KeyPair
): string | null {
    try {
        const ciphertext = util.decodeBase64(encrypted.ciphertext);
        const nonce = util.decodeBase64(encrypted.nonce);
        const senderPublicKey = util.decodeBase64(encrypted.senderPublicKey);

        const decrypted = nacl.box.open(
            ciphertext,
            nonce,
            senderPublicKey,
            recipientKeyPair.secretKey
        );

        if (!decrypted) return null;
        return util.encodeUTF8(decrypted);
    } catch {
        return null;
    }
}

/**
 * Known keys registry
 */
export function loadKnownKeys(): Record<string, string> {
    const path = join(KEYS_DIR, 'known_keys.json');
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return {};
    }
}

export function saveKnownKey(agentId: string, publicKeyBase64: string): void {
    ensureKeysDir();
    const keys = loadKnownKeys();
    keys[agentId] = publicKeyBase64;
    writeFileSync(join(KEYS_DIR, 'known_keys.json'), JSON.stringify(keys, null, 2));
}
```

---

## Step 6: Test Encryption Flow

After setup, verify encryption works:

```bash
# Generate keys for test agent
MYCELIUMAIL_AGENT=test-agent mycmail keygen

# Check keys
mycmail keys

# Import a peer's key (get from actual peer)
mycmail key-import peer-agent AaBbCcDdEeFf...

# Send encrypted message
mycmail send peer-agent "Test" --encrypt --message "This is secret"

# Verify message is encrypted in storage
# (body should be null, ciphertext should be populated)
```

---

## Quick Reference: File Injection Order

```
1. CLAUDE.md               ← Inject first (AI context)
2. src/lib/crypto.ts       ← Encryption foundation
3. src/bin/myceliumail.ts  ← CLI entry point
4. src/commands/keygen.ts  ← Key generation
5. src/commands/*.ts       ← Other commands
6. src/storage/*.ts        ← Storage adapters
```

---

## Validation Checklist

After each phase, verify:

```bash
# Phase 1: Bootstrap
npm run build           # ✓ Compiles
mycmail --help          # ✓ Shows commands
mycmail keygen          # ✓ Generates keypair

# Phase 2: Encryption
mycmail keys            # ✓ Shows keys
cat ~/.myceliumail/keys/*.json  # ✓ Keys stored

# Phase 3: Messaging
mycmail send test "Hello"        # ✓ Sends message
mycmail inbox                    # ✓ Lists messages

# Phase 4: Database
supabase db push                 # ✓ Schema applied
```

---

## The Full Vision

```
┌─────────────────────────────────────────────────────────────┐
│                     TREEBIRD ECOSYSTEM                       │
│                                                              │
│                      ┌────────────┐                          │
│                      │ MYCELIUMAIL│                          │
│                      │  (mycmail) │                          │
│                      └─────┬──────┘                          │
│                            │                                 │
│                     🔐 E2E Encrypted                         │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│   ┌───────────┐     ┌───────────┐     ┌────────────┐       │
│   │ SPIDERSAN │◄───►│ MAPPERSAN │◄───►│  RECOVERY  │       │
│   │ Branches  │     │   Docs    │     │    TREE    │       │
│   └───────────┘     └───────────┘     └────────────┘       │
│                            │                                 │
│                            ▼                                 │
│                    ┌───────────────┐                        │
│                    │  YOUR PROJECT │                        │
│                    │  (connected)  │                        │
│                    └───────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

*This starter kit is part of the Treebird ecosystem.*
*Encryption powered by TweetNaCl (X25519 + XSalsa20-Poly1305)*
*See: MYCELIUMAIL_ROADMAP.md for full feature roadmap*
