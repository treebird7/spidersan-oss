import * as Y from 'yjs';

export interface Lock {
    symbolId: string;
    agentId: string;
    astHash: string;
    timestamp: number;
}

export class SwarmState {
    public doc: Y.Doc;
    public locks: Y.Map<any>;
    public agentId: string;

    constructor(agentId: string) {
        this.doc = new Y.Doc();
        this.agentId = agentId;
        this.locks = this.doc.getMap('locks');

        // Log own updates
        this.doc.on('update', (update) => {
            // In a real app, this goes to the relay
        });
    }

    acquireLock(symbolId: string, astHash: string): boolean {
        // Check if locked by someone else
        const existingLock = this.locks.get(symbolId) as Lock | undefined;
        if (existingLock && existingLock.agentId !== this.agentId) {
            return false; // Already locked
        }

        // Write lock
        const lock: Lock = {
            symbolId,
            agentId: this.agentId,
            astHash,
            timestamp: Date.now()
        };
        this.locks.set(symbolId, lock);
        return true;
    }

    getLock(symbolId: string): Lock | undefined {
        return this.locks.get(symbolId) as Lock | undefined;
    }

    applyUpdate(update: Uint8Array) {
        Y.applyUpdate(this.doc, update);
    }
}
