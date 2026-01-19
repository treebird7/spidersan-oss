import { SwarmState } from './state';
import * as Y from 'yjs';

export class MockRelay {
    private peers: SwarmState[] = [];

    register(peer: SwarmState) {
        this.peers.push(peer);

        // Listen to updates from this peer
        peer.doc.on('update', (update: Uint8Array) => {
            this.broadcast(update, peer.agentId);
        });
    }

    broadcast(update: Uint8Array, senderId: string) {
        this.peers.forEach(p => {
            if (p.agentId !== senderId) {
                // Determine latency (simulated)
                // const latency = Math.random() * 50; 
                p.applyUpdate(update);
            }
        });
    }
}
