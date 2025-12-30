export { initCommand } from './init.js';
export { registerCommand } from './register.js';
export { listCommand } from './list.js';
export { conflictsCommand } from './conflicts.js';
export { mergeOrderCommand } from './merge-order.js';
export { readyCheckCommand } from './ready-check.js';
export { dependsCommand } from './depends.js';
export { staleCommand } from './stale.js';
export { cleanupCommand } from './cleanup.js';
export { abandonCommand } from './abandon.js';
export { mergedCommand } from './merged.js';
export { syncCommand } from './sync.js';

// Messaging commands
export { sendCommand } from './send.js';
export { inboxCommand } from './inbox.js';
export { msgReadCommand } from './msg-read.js';

// Key management commands
export { keygenCommand } from './keygen.js';
export { keyImportCommand } from './key-import.js';
export { keysCommand } from './keys.js';

// License commands
export { activateCommand } from './activate.js';
export { statusCommand } from './status.js';

// Session lifecycle commands
export { wakeCommand } from './wake.js';
export { closeCommand } from './close.js';

// Collab command
export { registerCollabCommand as collabCommand } from './collab.js';

// Diagnostics
export { doctorCommand } from './doctor.js';
export { pulseCommand } from './pulse.js';
export { completionsCommand } from './completions.js';

// Security Pipeline (ssan + srlk)
export { tensionCommand } from './tension.js';
export { auditMarkCommand } from './audit-mark.js';

// Session logging
export { logCommand } from './log.js';

// Daemon mode
export { watchCommand } from './watch.js';

// Demo/Onboarding
export { demoCommand } from './demo.js';
