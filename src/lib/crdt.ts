/**
 * Spidersan CRDT State
 * 
 * Decentralized symbol locking using Yjs CRDTs.
 * Allows agents to claim symbols before editing, preventing conflicts.
 * 
 * @module crdt
 */

import * as Y from 'yjs';

export interface SymbolLock {
    symbolId: string;      // e.g., "src/lib/security.ts:validateAgentId"
    agentId: string;       // e.g., "sherlocksan"
    astHash: string;       // Hash of symbol at lock time
    timestamp: number;     // Lock acquisition time
    description?: string;  // Optional: what the agent intends to do
}

export interface SwarmStateOptions {
    agentId: string;
    onUpdate?: (update: Uint8Array) => void;  // Callback for sync
}

export class SwarmState {
    public doc: Y.Doc;
    public locks: Y.Map<SymbolLock>;
    public intents: Y.Map<string>;  // agentId -> current intent
    public agentId: string;
    private onUpdate?: (update: Uint8Array) => void;

    constructor(options: SwarmStateOptions) {
        this.doc = new Y.Doc();
        this.agentId = options.agentId;
        this.onUpdate = options.onUpdate;

        this.locks = this.doc.getMap('locks');
        this.intents = this.doc.getMap('intents');

        // Propagate updates to sync callback
        this.doc.on('update', (update: Uint8Array) => {
            if (this.onUpdate) {
                this.onUpdate(update);
            }
        });
    }

    /**
     * Try to acquire a lock on a symbol
     * Returns true if lock acquired, false if already locked by another agent
     */
    acquireLock(symbolId: string, astHash: string, description?: string): boolean {
        const existingLock = this.locks.get(symbolId);

        // Check if locked by another agent
        if (existingLock && existingLock.agentId !== this.agentId) {
            // Check if lock is stale (older than 30 minutes)
            const staleThreshold = 30 * 60 * 1000;
            if (Date.now() - existingLock.timestamp > staleThreshold) {
                console.warn(`🕷️ Taking over stale lock on ${symbolId} from ${existingLock.agentId}`);
            } else {
                return false;  // Still locked by active agent
            }
        }

        // Acquire or refresh lock
        const lock: SymbolLock = {
            symbolId,
            agentId: this.agentId,
            astHash,
            timestamp: Date.now(),
            description,
        };
        this.locks.set(symbolId, lock);
        return true;
    }

    /**
     * Release a lock on a symbol
     */
    releaseLock(symbolId: string): boolean {
        const lock = this.locks.get(symbolId);
        if (lock && lock.agentId === this.agentId) {
            this.locks.delete(symbolId);
            return true;
        }
        return false;
    }

    /**
     * Release all locks held by this agent
     */
    releaseAllLocks(): number {
        let released = 0;
        this.locks.forEach((lock, symbolId) => {
            if (lock.agentId === this.agentId) {
                this.locks.delete(symbolId);
                released++;
            }
        });
        return released;
    }

    /**
     * Get lock info for a symbol
     */
    getLock(symbolId: string): SymbolLock | undefined {
        return this.locks.get(symbolId);
    }

    /**
     * Check if a symbol is locked by another agent
     */
    isLockedByOther(symbolId: string): boolean {
        const lock = this.locks.get(symbolId);
        return lock !== undefined && lock.agentId !== this.agentId;
    }

    /**
     * Get all locks held by a specific agent
     */
    getAgentLocks(agentId: string): SymbolLock[] {
        const locks: SymbolLock[] = [];
        this.locks.forEach((lock) => {
            if (lock.agentId === agentId) {
                locks.push(lock);
            }
        });
        return locks;
    }

    /**
     * Get all active locks
     */
    getAllLocks(): SymbolLock[] {
        const locks: SymbolLock[] = [];
        this.locks.forEach((lock) => locks.push(lock));
        return locks;
    }

    /**
     * Set current intent for this agent
     */
    setIntent(intent: string): void {
        this.intents.set(this.agentId, intent);
    }

    /**
     * Get intent for an agent
     */
    getIntent(agentId: string): string | undefined {
        return this.intents.get(agentId);
    }

    /**
     * Get all agent intents
     */
    getAllIntents(): Map<string, string> {
        const intents = new Map<string, string>();
        this.intents.forEach((intent, agentId) => {
            intents.set(agentId, intent);
        });
        return intents;
    }

    /**
     * Apply an update from another agent
     */
    applyUpdate(update: Uint8Array): void {
        Y.applyUpdate(this.doc, update);
    }

    /**
     * Get the current state as an update (for initial sync)
     */
    getStateAsUpdate(): Uint8Array {
        return Y.encodeStateAsUpdate(this.doc);
    }

    /**
     * Merge state from another SwarmState instance
     */
    mergeFrom(other: SwarmState): void {
        const update = other.getStateAsUpdate();
        this.applyUpdate(update);
    }
}

// Factory function for creating connected swarm states
export function createSwarmState(agentId: string, onUpdate?: (update: Uint8Array) => void): SwarmState {
    return new SwarmState({ agentId, onUpdate });
}
