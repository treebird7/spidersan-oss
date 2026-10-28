import { SwarmState } from './state';
import { MockRelay } from './relay';

// 1. Setup Network
const relay = new MockRelay();

// 2. Setup Agents
const agentA = new SwarmState('agent-A');
const agentB = new SwarmState('agent-B');

// 3. Connect to Relay
relay.register(agentA);
relay.register(agentB);

console.log("--- Initial State ---");
console.log("Agent A Locks:", agentA.locks.toJSON());
console.log("Agent B Locks:", agentB.locks.toJSON());

// 4. Agent A acquires lock
console.log("\n--- Agent A Acquires Lock 'funcA' ---");
const successA = agentA.acquireLock('funcA', 'hash123');
console.log(`Agent A acquire result: ${successA}`);

// 5. Verify Propagation
console.log("\n--- Verifying Propagation ---");
console.log("Agent B sees lock for 'funcA':", agentB.getLock('funcA'));

// 6. Agent B tries to acquire same lock (Conflict)
console.log("\n--- Agent B Tries to Acquire 'funcA' ---");
const successB = agentB.acquireLock('funcA', 'hash999');
console.log(`Agent B acquire result: ${successB} (Expected: false)`);

// 7. Agent B acquires free lock 'funcB'
console.log("\n--- Agent B Acquires 'funcB' ---");
const successB2 = agentB.acquireLock('funcB', 'hash456');
console.log(`Agent B acquire result: ${successB2} (Expected: true)`);
console.log("Agent A sees lock for 'funcB':", agentA.getLock('funcB'));
