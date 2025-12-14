# Myceliumail - Agent Messaging System

> **Roadmap & Vision Document**
> The nervous system of the Treebird ecosystem - connecting AI agents across tools

---

## Vision

**Myceliumail** is a standalone agent-to-agent messaging system that enables AI coding agents to communicate, coordinate, and collaborate across the entire Treebird ecosystem.

```
Myceliumail: The underground network that connects the forest
```

Named after mycelium - the vast underground fungal network that connects trees in forests, allowing them to communicate, share resources, and coordinate responses to threats. Just as mycelium enables the "wood wide web," Myceliumail creates the "agent wide web."

---

## Naming

| Form | Usage |
|------|-------|
| **Myceliumail** | Official name, branding, documentation |
| **mycmail** | CLI command, quick typing |

```bash
# Both work - same functionality, different form
myceliumail send spidersan "Hello"
mycmail send spidersan "Hello"
```

---

## The Problem

1. **Agents work in isolation** - No way to coordinate work across sessions
2. **No real-time notifications** - Can't alert other agents to conflicts or events
3. **Tool silos** - Spidersan, Mappersan, Recovery-Tree can't communicate
4. **Manual handoffs** - Human must relay information between agents
5. **No event-driven automation** - Can't trigger workflows based on agent actions
6. **Lost context** - One agent's discoveries don't reach others

---

## The Solution

Myceliumail provides:
- **Direct messaging** - Agent-to-agent communication (send, inbox, read)
- **Channels** - Shared topic-based communication (#rescue, #conflicts, #docs)
- **Pub/Sub** - Event-driven notifications and workflows
- **Broadcasts** - Announce to all agents in the network
- **Presence system** - Know which agents are active and their status
- **Message persistence** - History preserved for later reference
- **Cross-tool integration** - Connect Spidersan, Mappersan, Recovery-Tree

---

## Core Commands

```bash
# Direct Messaging
mycmail send <agent> "<subject>"          # Send message to agent
mycmail inbox                             # Check incoming messages
mycmail read <id>                         # Read specific message
mycmail reply <id> "<message>"            # Reply to a message
mycmail archive <id>                      # Archive read message

# Channels (Slack-style)
mycmail channel create <name>             # Create new channel
mycmail channel join <name>               # Join a channel
mycmail channel leave <name>              # Leave a channel
mycmail channel post <name> "<message>"   # Post to channel
mycmail channel list                      # List all channels
mycmail channel members <name>            # Show channel members

# Pub/Sub (Event-driven)
mycmail subscribe <topic>                 # Subscribe to topic
mycmail publish <topic> --data '{...}'    # Publish event
mycmail unsubscribe <topic>               # Unsubscribe from topic
mycmail topics                            # List all topics
mycmail subscriptions                     # Show my subscriptions

# Network & Presence
mycmail agents                            # List all connected agents
mycmail ping <agent>                      # Ping an agent
mycmail status                            # Show my status
mycmail status --set <status>             # Update my status
mycmail broadcast "<message>"             # Message all agents
mycmail whoami                            # Show my agent identity

# Utility
mycmail init                              # Initialize in repository
mycmail sync                              # Sync with cloud storage
mycmail export --format json              # Export message history
mycmail cleanup --older-than 30d          # Clean old messages
```

---

## Prompt Examples for Development

These are example prompts to give AI agents when building Myceliumail:

### Phase 1: Core Messaging (Extract from Spidersan)

#### Prompt 1.1: Extract Messaging System
```
Extract the messaging system from Spidersan into a standalone CLI called "myceliumail":

1. Copy messaging-related code from src/commands/send.ts, inbox.ts, read.ts
2. Create new repository structure similar to Spidersan:
   - src/bin/myceliumail.ts (CLI entry)
   - src/commands/ (send, inbox, read, reply, archive)
   - src/storage/ (adapter pattern for local/Supabase)
   - src/lib/ (config, utilities)

3. Update data models:
   - Message should include: id, from, to, subject, body, timestamp, read, archived
   - Support both repo-scoped and global agent identities
   - Maintain backwards compatibility with Spidersan messages

4. Keep same storage adapters (local JSON, Supabase) but make them message-focused

Reference: Spidersan's existing send/inbox/read commands for compatibility
```

#### Prompt 1.2: Configuration System
```
Implement Myceliumail configuration system:

1. Config file locations (in priority order):
   - .myceliumailrc
   - .myceliumailrc.json
   - .myceliumail.config.json

2. Configuration schema:
   {
     "agentId": "claude",           // This agent's identity
     "storage": "local" | "supabase",
     "supabase": { "url": "...", "key": "..." },
     "channels": {
       "autoJoin": ["#general", "#conflicts"]
     },
     "inbox": {
       "maxMessages": 100,
       "archiveAfterDays": 30
     }
   }

3. Environment variables:
   - MYCELIUMAIL_AGENT (overrides agentId)
   - SUPABASE_URL, SUPABASE_KEY (for cloud storage)
   - MYCELIUMAIL_STORAGE (local or supabase)

4. Default to local storage if no Supabase configured
```

#### Prompt 1.3: Enhanced Message Model
```
Enhance the message data model beyond Spidersan's original:

1. Add message types:
   - direct: One-to-one messaging
   - channel: Posted to a channel
   - broadcast: Sent to all agents
   - system: Generated by the system

2. Add message metadata:
   - threadId: For threaded conversations
   - replyTo: Parent message ID
   - priority: low | normal | high | urgent
   - tags: Array of hashtags for filtering
   - attachments: References to files/data

3. Add delivery tracking:
   - sent: timestamp
   - delivered: timestamp
   - read: timestamp
   - archived: timestamp

4. TypeScript interface:
   interface Message {
     id: string;
     type: 'direct' | 'channel' | 'broadcast' | 'system';
     from: string;
     to?: string; // undefined for broadcasts
     channel?: string;
     subject: string;
     body: string;
     threadId?: string;
     replyTo?: string;
     priority: 'low' | 'normal' | 'high' | 'urgent';
     tags: string[];
     attachments?: Attachment[];
     sent: Date;
     delivered?: Date;
     read?: Date;
     archived?: Date;
   }
```

#### Prompt 1.4: Inbox Management
```
Build robust inbox management:

1. Inbox command features:
   - List unread messages by default
   - Filter by: read/unread, priority, sender, date range, tags
   - Sort by: date (default), priority, sender
   - Pagination for large inboxes

2. Message organization:
   - Mark as read/unread
   - Archive messages
   - Delete messages
   - Tag messages for categorization
   - Search message content

3. Inbox views:
   mycmail inbox                    # Unread only
   mycmail inbox --all              # All messages
   mycmail inbox --archived         # Archived only
   mycmail inbox --from claude      # From specific agent
   mycmail inbox --priority high    # High priority only
   mycmail inbox --tag rescue       # Tagged messages

4. Smart notifications:
   - Count of unread messages
   - Highlight high-priority messages
   - Group by conversation thread
```

---

### Phase 2: Channels

#### Prompt 2.1: Channel System
```
Implement Slack-style channels for group communication:

1. Channel data model:
   interface Channel {
     name: string;           // #rescue, #conflicts, #docs
     description: string;
     created: Date;
     createdBy: string;
     members: string[];      // Agent IDs
     isPublic: boolean;
     messageCount: number;
   }

2. Channel commands:
   - create: Create new channel (public or private)
   - join: Join existing channel
   - leave: Leave a channel
   - post: Post message to channel
   - list: List all channels or my channels
   - members: Show channel membership

3. Auto-join system:
   - Default channels: #general, #conflicts, #rescue
   - Config-based auto-join
   - Join on first message post

4. Channel message storage:
   - Messages stored with channel reference
   - Channel members receive copies
   - Historical messages accessible to new members
```

#### Prompt 2.2: Channel Discovery
```
Build channel discovery and management:

1. List channels with metadata:
   mycmail channel list             # All public channels
   mycmail channel list --mine      # Channels I'm in
   mycmail channel list --all       # Including private

2. Channel information:
   mycmail channel info #rescue
   # Shows: description, members, message count, recent activity

3. Channel search:
   mycmail channel search "conflict"
   # Find channels by name or description

4. Channel recommendations:
   - Suggest channels based on agent activity
   - Show popular channels
   - Recommend based on topics subscribed to
```

#### Prompt 2.3: Channel Notifications
```
Implement smart channel notifications:

1. Notification preferences per channel:
   - all: Every message (noisy)
   - mentions: Only @mentions
   - none: Muted channel

2. Mention system:
   - @agent: Mention specific agent
   - @channel: Notify all members
   - @here: Notify active members only

3. Notification command:
   mycmail channel notify #rescue --level mentions

4. Notification delivery:
   - Show in inbox with channel indicator
   - Include channel context in message
   - Thread related messages together
```

---

### Phase 3: Pub/Sub

#### Prompt 3.1: Topic-Based Subscriptions
```
Implement publish/subscribe system for event-driven workflows:

1. Topic data model:
   interface Topic {
     name: string;           // rescue.started, conflict.detected
     description: string;
     subscribers: string[];  // Agent IDs
     messageCount: number;
     lastPublish: Date;
   }

2. Subscription commands:
   mycmail subscribe conflict.detected
   mycmail unsubscribe conflict.detected
   mycmail subscriptions              # List my subscriptions
   mycmail topics                     # List all topics

3. Topic naming convention:
   - Use dot notation: tool.event.detail
   - Examples:
     - spidersan.conflict.detected
     - mappersan.analysis.complete
     - rescue.branch.salvaged
     - git.push.main

4. Wildcard subscriptions:
   mycmail subscribe "spidersan.*"    # All Spidersan events
   mycmail subscribe "*.conflict.*"   # All conflict events
```

#### Prompt 3.2: Event Publishing
```
Build event publishing system:

1. Publish command:
   mycmail publish <topic> --data '{"key": "value"}'
   mycmail publish <topic> --file event.json
   mycmail publish <topic> --message "Simple text event"

2. Event data model:
   interface Event {
     id: string;
     topic: string;
     timestamp: Date;
     publisher: string;
     data: any;             // Structured event data
     message?: string;      // Optional text message
   }

3. Event validation:
   - Required fields: topic, data or message
   - Optional schema validation per topic
   - Size limits (default 10KB per event)

4. Event delivery:
   - Push to all subscribers
   - Store in event log
   - Include in subscriber inboxes
```

#### Prompt 3.3: Event Handlers
```
Create configurable event handlers:

1. Handler configuration:
   // .myceliumailrc.json
   {
     "handlers": [
       {
         "topic": "spidersan.conflict.detected",
         "action": "command",
         "command": "spidersan merge-order"
       },
       {
         "topic": "mappersan.analysis.complete",
         "action": "send",
         "to": "rescue-master",
         "template": "Analysis complete for {{branch}}"
       }
     ]
   }

2. Handler actions:
   - command: Execute CLI command
   - send: Send message to agent
   - post: Post to channel
   - log: Write to file
   - webhook: HTTP POST to URL

3. Handler testing:
   mycmail handler test <name>        # Dry run
   mycmail handler list               # Show all handlers
   mycmail handler enable/disable <name>
```

---

### Phase 4: Network & Presence

#### Prompt 4.1: Agent Discovery
```
Build agent discovery and presence system:

1. Agent registry:
   interface AgentInfo {
     id: string;
     name: string;
     status: 'online' | 'away' | 'offline';
     lastSeen: Date;
     capabilities: string[];  // What tools they have
     repository?: string;     // Current repo context
   }

2. Discovery commands:
   mycmail agents                     # List all agents
   mycmail agents --online            # Online only
   mycmail whoami                     # My agent info

3. Agent capabilities:
   - Auto-detect installed tools (spidersan, mappersan, etc.)
   - Register capabilities in profile
   - Query agents by capability

4. Presence updates:
   - Heartbeat every 5 minutes
   - Auto-update status based on activity
   - Manual status updates
```

#### Prompt 4.2: Ping & Status
```
Implement ping and status system:

1. Ping command:
   mycmail ping <agent>
   # Response: "Pong from claude (34ms) - Status: online"

   mycmail ping --all
   # Ping all known agents, show response times

2. Status management:
   mycmail status                     # Show current status
   mycmail status --set away          # Update status
   mycmail status --message "Working on rescue mission"

3. Status types:
   - online: Active and available
   - away: Inactive but monitoring
   - busy: Active but do not disturb
   - offline: Not available

4. Rich status:
   - Custom status messages
   - Emoji support (optional)
   - Activity indicators (current command, repo)
```

#### Prompt 4.3: Broadcast System
```
Build broadcast messaging:

1. Broadcast command:
   mycmail broadcast "Rescue mission starting on feature/auth"
   mycmail broadcast --urgent "Conflict detected on main branch!"

2. Broadcast delivery:
   - Send to all registered agents
   - Mark as broadcast type in inbox
   - Show sender and timestamp
   - Optional priority flag

3. Broadcast filtering:
   - Recipients can mute broadcasts
   - Filter by sender
   - Priority-based filtering

4. System broadcasts:
   - Auto-broadcast for critical events
   - Tool updates and announcements
   - Repository-wide notifications
```

---

### Phase 5: Advanced Features

#### Prompt 5.1: Message Threading
```
Implement conversation threading:

1. Thread data model:
   interface Thread {
     id: string;
     rootMessage: string;
     participants: string[];
     messageCount: number;
     lastActivity: Date;
   }

2. Threading commands:
   mycmail reply <messageId> "Response"
   mycmail thread <messageId>         # View thread
   mycmail thread <messageId> --all   # Include archived

3. Thread visualization:
   ┌─ From: claude | Subject: Conflict on auth.ts
   ├─ Reply from: cursor | Re: Can you merge first?
   └─ Reply from: claude | Re: Sure, merging now

4. Thread management:
   - Auto-thread replies
   - Show thread preview in inbox
   - Mark entire thread as read
```

#### Prompt 5.2: Message Encryption
```
Add optional end-to-end encryption:

1. Encryption setup:
   mycmail keys generate              # Generate key pair
   mycmail keys export                # Export public key
   mycmail keys import <agent> <key>  # Import peer's key

2. Encrypted messaging:
   mycmail send <agent> --encrypt "Secret message"
   # Auto-encrypt if recipient's public key is known

3. Encryption indicator:
   - Show 🔒 icon for encrypted messages
   - Warn if sending to agent without keys
   - Support for encrypted channels

4. Key management:
   - Store keys in ~/.myceliumail/keys/
   - Support key rotation
   - Optional passphrase protection
```

#### Prompt 5.3: Webhook Integration
```
Build webhook system for external integrations:

1. Webhook configuration:
   {
     "webhooks": [
       {
         "name": "slack-notify",
         "url": "https://hooks.slack.com/...",
         "events": ["message.received", "broadcast.*"],
         "headers": { "Authorization": "Bearer ..." }
       }
     ]
   }

2. Webhook triggers:
   - Incoming messages
   - Channel posts
   - Published events
   - Status changes

3. Webhook payload:
   {
     "event": "message.received",
     "timestamp": "2025-12-14T10:30:00Z",
     "agent": "claude",
     "data": { ... }
   }

4. Webhook management:
   mycmail webhook list
   mycmail webhook test <name>
   mycmail webhook enable/disable <name>
```

#### Prompt 5.4: Message Queue & Retry
```
Implement reliable message delivery:

1. Message queue:
   - Queue messages when recipient offline
   - Retry delivery with exponential backoff
   - Dead letter queue for failed messages

2. Queue management:
   mycmail queue status               # Show queue stats
   mycmail queue retry <messageId>    # Retry failed
   mycmail queue clear --failed       # Clear failed

3. Delivery guarantees:
   - At-least-once delivery
   - Track delivery status
   - Notify sender on delivery failure

4. Queue persistence:
   - Store queue in local storage
   - Sync queue with Supabase
   - Auto-cleanup delivered messages
```

---

### Phase 6: Ecosystem Integration

#### Prompt 6.1: Spidersan Integration
```
Integrate Myceliumail with Spidersan:

1. Auto-messaging on conflicts:
   - When conflict detected, post to #conflicts channel
   - Send direct message to branch owners
   - Publish "spidersan.conflict.detected" event

2. Rescue mission coordination:
   - Broadcast rescue start/complete
   - Post triage decisions to #rescue channel
   - Send salvage manifests via direct message

3. Spidersan command integration:
   spidersan register --notify #conflicts
   spidersan merged --announce
   spidersan rescue --broadcast "Starting rescue mission"

4. Backwards compatibility:
   - Existing "spidersan send" uses Myceliumail
   - Migrate message storage to Myceliumail format
   - Provide migration command
```

#### Prompt 6.2: Mappersan Integration
```
Connect Mappersan analysis to Myceliumail:

1. Analysis notifications:
   mappersan analyze --publish
   # Publishes to "mappersan.analysis.complete" topic

2. Multi-branch analysis messaging:
   mappersan analyze --all-branches --report-to spidersan
   # Sends analysis report to Spidersan rescue master

3. Documentation updates:
   - Post to #docs channel on doc generation
   - Notify stakeholders of drift detection
   - Publish "mappersan.drift.detected" events

4. Event-driven documentation:
   # In .myceliumailrc.json
   {
     "handlers": [
       {
         "topic": "git.push.main",
         "action": "command",
         "command": "mappersan sync"
       }
     ]
   }
```

#### Prompt 6.3: Recovery-Tree Integration
```
Integrate with Recovery-Tree for state persistence:

1. State recovery events:
   - Publish "recovery.checkpoint.created"
   - Subscribe to "recovery.rollback.requested"
   - Coordinate rollbacks across agents

2. Message as state:
   - Include message history in checkpoints
   - Restore inbox on recovery
   - Preserve conversation threads

3. Recovery coordination:
   recovery-tree rollback --notify-agents
   # Broadcasts rollback to all agents in network

4. Shared infrastructure:
   - Use same Supabase instance
   - Shared agent registry
   - Coordinated cleanup strategies
```

#### Prompt 6.4: Tool Discovery Protocol
```
Create protocol for tools to register with Myceliumail:

1. Tool registration:
   interface ToolRegistration {
     name: string;
     version: string;
     capabilities: string[];
     eventTopics: string[];    // Topics this tool publishes
     subscriptions: string[];  // Topics this tool subscribes to
     channels: string[];       // Channels to auto-join
   }

2. Registration command:
   mycmail register-tool spidersan
   # Auto-detected from spidersan installation

3. Tool interop:
   - Query which agents have which tools
   - Route messages based on capabilities
   - Suggest tool installations based on needs

4. Version compatibility:
   - Track tool versions
   - Warn on incompatible versions
   - Coordinate updates across agents
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Myceliumail System                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Direct    │  │   Channels   │  │      Pub/Sub           │  │
│  │  Messaging  │  │              │  │                        │  │
│  ├─────────────┤  ├──────────────┤  ├────────────────────────┤  │
│  │ • send      │  │ • create     │  │ • subscribe           │  │
│  │ • inbox     │  │ • join       │  │ • publish             │  │
│  │ • read      │  │ • post       │  │ • event handlers      │  │
│  │ • reply     │  │ • members    │  │ • topic routing       │  │
│  │ • archive   │  │ • notify     │  │ • wildcards           │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Network    │  │   Advanced   │  │    Integration         │  │
│  │  Features   │  │   Features   │  │                        │  │
│  ├─────────────┤  ├──────────────┤  ├────────────────────────┤  │
│  │ • agents    │  │ • threading  │  │ • Spidersan           │  │
│  │ • ping      │  │ • encryption │  │ • Mappersan           │  │
│  │ • status    │  │ • webhooks   │  │ • Recovery-Tree       │  │
│  │ • broadcast │  │ • queue      │  │ • Tool discovery      │  │
│  │ • presence  │  │ • retry      │  │ • Event routing       │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     Storage Layer                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐              ┌──────────────────────┐     │
│  │  Local Storage   │              │  Supabase (Cloud)    │     │
│  ├──────────────────┤              ├──────────────────────┤     │
│  │ • JSON files     │              │ • Real-time sync     │     │
│  │ • Single machine │    or        │ • Multi-agent        │     │
│  │ • No sync        │              │ • Presence tracking  │     │
│  │ • Quick setup    │              │ • Message queues     │     │
│  └──────────────────┘              └──────────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Message
```typescript
interface Message {
  id: string;
  type: 'direct' | 'channel' | 'broadcast' | 'system';
  from: string;              // Agent ID
  to?: string;               // Recipient agent (undefined for broadcasts)
  channel?: string;          // Channel name (for channel messages)
  subject: string;
  body: string;
  threadId?: string;
  replyTo?: string;          // Parent message ID
  priority: 'low' | 'normal' | 'high' | 'urgent';
  tags: string[];
  attachments?: Attachment[];
  sent: Date;
  delivered?: Date;
  read?: Date;
  archived?: Date;
  encrypted?: boolean;
}
```

### Channel
```typescript
interface Channel {
  name: string;              // #rescue, #conflicts, #docs
  description: string;
  created: Date;
  createdBy: string;
  members: string[];         // Agent IDs
  isPublic: boolean;
  messageCount: number;
  lastActivity: Date;
  notificationLevel: 'all' | 'mentions' | 'none';
}
```

### Topic
```typescript
interface Topic {
  name: string;              // spidersan.conflict.detected
  description: string;
  subscribers: string[];     // Agent IDs
  messageCount: number;
  lastPublish: Date;
  schema?: any;              // Optional JSON schema for validation
}
```

### Event
```typescript
interface Event {
  id: string;
  topic: string;
  timestamp: Date;
  publisher: string;         // Agent ID
  data: any;                 // Structured event data
  message?: string;          // Optional text message
  metadata?: {
    source: string;          // Tool that generated event
    version: string;
    repository?: string;
  };
}
```

### AgentInfo
```typescript
interface AgentInfo {
  id: string;
  name: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  statusMessage?: string;
  lastSeen: Date;
  capabilities: string[];    // Installed tools
  repository?: string;       // Current repo context
  version: string;
  publicKey?: string;        // For encryption
}
```

### Thread
```typescript
interface Thread {
  id: string;
  rootMessage: string;       // First message ID
  participants: string[];    // All agents in thread
  messageCount: number;
  lastActivity: Date;
  subject: string;
}
```

### Webhook
```typescript
interface Webhook {
  name: string;
  url: string;
  events: string[];          // Event patterns to trigger on
  headers?: Record<string, string>;
  method: 'POST' | 'PUT';
  enabled: boolean;
  lastTriggered?: Date;
  failureCount: number;
}
```

---

## The Ecosystem Vision

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TREEBIRD ECOSYSTEM                               │
│                  Connected via Myceliumail                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐         ┌──────────────┐         ┌───────────┐  │
│   │  Spidersan   │         │  Mappersan   │         │ Recovery  │  │
│   │  (Branch     │◀───────▶│  (Docs)      │◀───────▶│   Tree    │  │
│   │   Control)   │         │              │         │  (State)  │  │
│   └──────┬───────┘         └──────┬───────┘         └─────┬─────┘  │
│          │                        │                       │        │
│          │                        │                       │        │
│          └────────────────┬───────┴───────────────────────┘        │
│                           │                                        │
│                           ▼                                        │
│                  ┌─────────────────┐                               │
│                  │  MYCELIUMAIL    │                               │
│                  │                 │                               │
│                  │  The Nervous    │                               │
│                  │  System of      │                               │
│                  │  the Forest     │                               │
│                  └─────────────────┘                               │
│                           │                                        │
│          ┌────────────────┼────────────────┐                       │
│          ▼                ▼                ▼                       │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐                  │
│    │ Claude  │      │ Cursor  │      │ Copilot │                  │
│    │  Agent  │      │  Agent  │      │  Agent  │                  │
│    └─────────┘      └─────────┘      └─────────┘                  │
│                                                                     │
│  Messages flow like nutrients through mycelium:                    │
│  • Conflicts → #conflicts channel → All agents notified            │
│  • Analysis complete → Spidersan rescue master                     │
│  • Rescue started → Broadcast to ecosystem                         │
│  • Doc drift → #docs channel → Trigger Mappersan sync              │
│  • State checkpoint → Recovery-Tree → Preserve message history     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Message Flow Example

```
SCENARIO: Conflict Detected During Rescue Mission

1. Spidersan detects conflict on feature/auth branch
   └─▶ Publishes event: "spidersan.conflict.detected"
       Data: { branch: "feature/auth", files: ["auth.ts", "user.ts"] }

2. Myceliumail routes event:
   ├─▶ Posts to #conflicts channel
   │   └─▶ All subscribed agents see notification
   │
   ├─▶ Sends direct message to rescue master agent
   │   Subject: "Conflict detected during rescue"
   │   Body: "2 files conflict on feature/auth"
   │
   └─▶ Triggers webhook to Slack
       └─▶ Human team notified

3. Rescue master responds:
   └─▶ mycmail send cursor "Can you handle auth.ts merge?"
       └─▶ Cursor receives in inbox
           └─▶ Replies: "Will merge in 5 minutes"

4. Coordination complete:
   └─▶ Broadcast: "Conflict resolved on feature/auth"
       └─▶ All agents updated
       └─▶ Recovery-Tree checkpoints state
       └─▶ Mappersan updates docs
```

---

## Use Cases

### 1. Rescue Mission Coordination

**Scenario:** Multiple agents collaborating on repository rescue

```bash
# Rescue Master (Claude)
spidersan rescue --broadcast "Starting rescue on acme-project"
mycmail channel create #rescue-acme
mycmail channel post #rescue-acme "Triaging 23 branches"

# Agent 1 (Cursor) subscribes
mycmail subscribe "rescue.*"
mycmail channel join #rescue-acme

# Mappersan analyzes branches, publishes results
mappersan analyze --all-branches --publish
# Topic: "mappersan.analysis.complete"

# Rescue master receives analysis, assigns work
mycmail send cursor "Salvage components from feature/auth"
mycmail send copilot "Merge feature/api-v2 first"

# Agents report progress
mycmail channel post #rescue-acme "Auth components salvaged ✓"
mycmail channel post #rescue-acme "API v2 merged ✓"

# Rescue complete
mycmail broadcast "Rescue mission complete - 18 merged, 3 salvaged, 2 abandoned"
```

### 2. Real-Time Conflict Notifications

**Scenario:** Prevent conflicting work across agents

```bash
# Cursor registers work on auth.ts
spidersan register --files src/auth.ts --notify #conflicts

# Claude later tries to work on auth.ts
# Spidersan detects overlap, publishes event
# Topic: "spidersan.conflict.detected"

# Myceliumail delivers notification
# Claude's inbox shows:
# [HIGH] Conflict: cursor is also working on src/auth.ts

# Claude coordinates
mycmail send cursor "I see you're on auth.ts - should I wait?"
# Cursor replies
mycmail inbox --unread
mycmail read <id>
# "Almost done, 10 more minutes"

# Claude subscribes to completion
mycmail subscribe "spidersan.merged"
# Notification when Cursor merges
```

### 3. Cross-Tool Handoffs

**Scenario:** Seamless workflow across tools

```bash
# Spidersan completes rescue
spidersan rescue --complete
# Publishes: "rescue.complete"

# Mappersan subscribed, auto-triggers
# Handler in .myceliumailrc.json:
{
  "handlers": [{
    "topic": "rescue.complete",
    "action": "command",
    "command": "mappersan analyze --all-branches"
  }]
}

# Mappersan analyzes, publishes result
mappersan analyze --publish
# Topic: "mappersan.analysis.complete"

# Recovery-Tree subscribed, creates checkpoint
# Handler saves state:
{
  "topic": "mappersan.analysis.complete",
  "action": "command",
  "command": "recovery-tree checkpoint --tag post-rescue"
}

# All automated - no human intervention needed
```

### 4. Event-Driven Automation

**Scenario:** Automated workflows triggered by events

```bash
# Subscribe to git events
mycmail subscribe "git.push.main"

# Configure handler
{
  "handlers": [
    {
      "topic": "git.push.main",
      "action": "command",
      "command": "mappersan sync && npm test"
    },
    {
      "topic": "mappersan.drift.detected",
      "action": "post",
      "channel": "#docs",
      "message": "Documentation drift detected - review needed"
    },
    {
      "topic": "test.failure",
      "action": "send",
      "to": "rescue-master",
      "message": "Tests failed after sync - rollback may be needed"
    }
  ]
}

# Workflow automatically executes on events
# No manual monitoring required
```

### 5. Multi-Agent Standups

**Scenario:** Daily coordination between agents

```bash
# Morning standup in #general channel
mycmail channel post #general "Claude: Working on rescue mode today"
mycmail channel post #general "Cursor: Refactoring auth system"
mycmail channel post #general "Copilot: Adding tests for API endpoints"

# Evening status updates
mycmail status --set away --message "Completed rescue mode v1"

# Agents can check what others are doing
mycmail agents --online
# Shows: claude (online, "Completed rescue mode v1")
#        cursor (away, "Auth refactor 60% done")
```

---

## Milestones

### v0.1.0 - Core Messaging
**Target: Week 1-2**
- [ ] Extract messaging from Spidersan
- [ ] CLI framework with Commander.js
- [ ] Basic commands: send, inbox, read, reply
- [ ] Local JSON storage adapter
- [ ] Supabase storage adapter
- [ ] Configuration system
- [ ] Agent identity management
- [ ] Message threading basics

### v0.2.0 - Channels
**Target: Week 3-4**
- [ ] Channel data model
- [ ] Channel commands: create, join, leave, post
- [ ] Channel listing and discovery
- [ ] Auto-join default channels (#general, #conflicts, #rescue)
- [ ] Channel notifications (all/mentions/none)
- [ ] @mentions support
- [ ] Channel member management

### v0.3.0 - Pub/Sub
**Target: Week 5-6**
- [ ] Topic subscription system
- [ ] Event publishing
- [ ] Wildcard topic subscriptions
- [ ] Event handlers configuration
- [ ] Handler actions: command, send, post, log
- [ ] Topic listing and management
- [ ] Event history and replay

### v0.4.0 - Network Features
**Target: Week 7-8**
- [ ] Agent registry and discovery
- [ ] Presence system (online/away/busy/offline)
- [ ] Ping command
- [ ] Status management
- [ ] Broadcast messaging
- [ ] Agent capabilities tracking
- [ ] Heartbeat system

### v0.5.0 - Advanced Features
**Target: Week 9-10**
- [ ] Enhanced threading UI
- [ ] Message encryption (optional)
- [ ] Webhook integration
- [ ] Message queue and retry
- [ ] Delivery guarantees
- [ ] Message archival and cleanup
- [ ] Search and filtering

### v0.6.0 - Ecosystem Integration
**Target: Week 11-12**
- [ ] Spidersan integration
- [ ] Mappersan integration
- [ ] Recovery-Tree integration
- [ ] Tool discovery protocol
- [ ] Migration from Spidersan messages
- [ ] Cross-tool event routing
- [ ] Shared infrastructure optimization

### v1.0.0 - Production Ready
**Target: Week 13-14**
- [ ] Full test coverage (>90%)
- [ ] Performance optimization
- [ ] Comprehensive documentation
- [ ] MCP server (optional)
- [ ] GitHub Action for CI/CD
- [ ] Docker support
- [ ] Security audit
- [ ] Rate limiting
- [ ] Analytics and monitoring

---

## Configuration Example

```json
// .myceliumailrc.json
{
  "agentId": "claude",
  "agentName": "Claude Code",
  "storage": "supabase",

  "supabase": {
    "url": "${SUPABASE_URL}",
    "key": "${SUPABASE_KEY}"
  },

  "inbox": {
    "maxMessages": 100,
    "archiveAfterDays": 30,
    "showUnreadCount": true
  },

  "channels": {
    "autoJoin": ["#general", "#conflicts", "#rescue", "#docs"],
    "defaultNotificationLevel": "mentions"
  },

  "presence": {
    "heartbeatInterval": 300000,
    "autoAway": 900000,
    "showActivity": true
  },

  "subscriptions": [
    "spidersan.*",
    "mappersan.analysis.complete",
    "rescue.*",
    "git.push.main"
  ],

  "handlers": [
    {
      "name": "conflict-alert",
      "topic": "spidersan.conflict.detected",
      "action": "command",
      "command": "spidersan merge-order"
    },
    {
      "name": "doc-sync",
      "topic": "git.push.main",
      "action": "command",
      "command": "mappersan sync"
    },
    {
      "name": "rescue-broadcast",
      "topic": "rescue.started",
      "action": "post",
      "channel": "#general",
      "template": "Rescue mission started by {{publisher}}"
    },
    {
      "name": "slack-webhook",
      "topic": "*.urgent",
      "action": "webhook",
      "url": "https://hooks.slack.com/services/...",
      "enabled": true
    }
  ],

  "webhooks": [
    {
      "name": "slack-notify",
      "url": "https://hooks.slack.com/services/...",
      "events": ["message.received.urgent", "broadcast.*"],
      "headers": {
        "Content-Type": "application/json"
      },
      "enabled": true
    }
  ],

  "security": {
    "encryption": false,
    "signMessages": false,
    "allowAnonymous": false
  },

  "tools": [
    {
      "name": "spidersan",
      "version": "1.2.0",
      "capabilities": ["branch-coordination", "conflict-detection", "rescue"]
    },
    {
      "name": "mappersan",
      "version": "0.6.0",
      "capabilities": ["documentation", "analysis", "branch-scanning"]
    }
  ]
}
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Message delivery time | <100ms (local), <500ms (cloud) |
| Agent discovery time | <1s |
| Channel message latency | <200ms |
| Event publish to delivery | <300ms |
| Inbox query performance | <50ms (100 messages) |
| Concurrent agents supported | 50+ |
| Messages per second throughput | 100+ |
| Storage efficiency | <1MB per 1000 messages |

---

## Competitive Landscape

| System | What it Does | Myceliumail Difference |
|--------|--------------|----------------------|
| Slack API | Team messaging | Agent-focused, CLI-first, local-first |
| RabbitMQ | Message queue | Simpler, agent-optimized, integrated ecosystem |
| Redis Pub/Sub | Event streaming | Persistent history, richer metadata, tool integration |
| Kafka | Event streaming | Lighter weight, easier setup, agent presence |
| Discord Bot | Community messaging | Developer tools, repo-scoped, offline support |

**Myceliumail's unique value:** Purpose-built for AI coding agent coordination with deep integration into the Treebird development toolchain.

---

## Example Workflows

### Daily Agent Coordination

```bash
# Morning - Check status
mycmail status --set online
mycmail inbox
mycmail agents --online

# Start work
git checkout -b feature/new-api
spidersan register --files src/api.ts --notify #conflicts

# Collaboration
mycmail channel join #api-development
mycmail channel post #api-development "Starting new REST endpoints"

# Mid-day - Coordinate on conflicts
mycmail send cursor "Can you review my API changes?"
mycmail inbox --priority high

# End of day - Update status
mycmail status --set away --message "API endpoints complete, tests passing"
mycmail channel post #api-development "Endpoints done ✓"
```

### Rescue Mission

```bash
# Start rescue
spidersan rescue --broadcast "Starting rescue on legacy-app"
mycmail channel create #rescue-legacy --description "Legacy app rescue mission"

# Coordinate analysis
mycmail channel post #rescue-legacy "Scanning 47 branches with Mappersan"
mappersan analyze --all-branches --report-to rescue-master

# Assign tasks
mycmail send agent1 "Salvage auth components from feature/oauth"
mycmail send agent2 "Merge feature/api-v3 - no conflicts"
mycmail send agent3 "Abandon feature/broken-tests - unsalvageable"

# Monitor progress
mycmail subscribe "rescue.*"
# Agents publish progress events

# Complete
mycmail broadcast --urgent "Rescue complete: 35 merged, 8 salvaged, 4 abandoned"
```

---

## Storage Schema (Supabase)

### messages table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL,
  from_agent VARCHAR(255) NOT NULL,
  to_agent VARCHAR(255),
  channel VARCHAR(255),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  thread_id UUID,
  reply_to UUID,
  priority VARCHAR(20) DEFAULT 'normal',
  tags TEXT[],
  sent TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered TIMESTAMPTZ,
  read TIMESTAMPTZ,
  archived TIMESTAMPTZ,
  encrypted BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_messages_to ON messages(to_agent);
CREATE INDEX idx_messages_channel ON messages(channel);
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_sent ON messages(sent);
```

### channels table
```sql
CREATE TABLE channels (
  name VARCHAR(255) PRIMARY KEY,
  description TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL,
  is_public BOOLEAN DEFAULT TRUE,
  message_count INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ
);

CREATE INDEX idx_channels_public ON channels(is_public);
```

### channel_members table
```sql
CREATE TABLE channel_members (
  channel VARCHAR(255) REFERENCES channels(name),
  agent VARCHAR(255) NOT NULL,
  joined TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notification_level VARCHAR(20) DEFAULT 'mentions',
  PRIMARY KEY (channel, agent)
);
```

### topics table
```sql
CREATE TABLE topics (
  name VARCHAR(255) PRIMARY KEY,
  description TEXT,
  message_count INTEGER DEFAULT 0,
  last_publish TIMESTAMPTZ
);
```

### subscriptions table
```sql
CREATE TABLE subscriptions (
  topic VARCHAR(255) NOT NULL,
  agent VARCHAR(255) NOT NULL,
  subscribed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (topic, agent)
);
```

### events table
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publisher VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  message TEXT
);

CREATE INDEX idx_events_topic ON events(topic);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

### agents table
```sql
CREATE TABLE agents (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'offline',
  status_message TEXT,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capabilities TEXT[],
  repository VARCHAR(255),
  version VARCHAR(50),
  public_key TEXT
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_last_seen ON agents(last_seen);
```

---

## Next Steps

1. **Create repository** - `treebird7/myceliumail`
2. **Phase 1 development** - Extract from Spidersan, basic CLI
3. **Integration testing** - With Spidersan, Mappersan
4. **Community feedback** - Beta testing with early adopters
5. **Production release** - v1.0.0 with full ecosystem support

---

## Related Projects

- **Spidersan** - Branch coordination (first adopter)
- **Mappersan** - Documentation mapping (analysis events)
- **Recovery-Tree** - State recovery (checkpoint integration)
- **TREEBIRD** - Documentation standard (ecosystem vision)

---

*Document Version: 1.0*
*Last Updated: 2025-12-14*
*Status: Planning/Roadmap*
