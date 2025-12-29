/**
 * spidersan log
 * 
 * Record successful multi-agent collaboration sessions for future reference.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SessionLog {
    id: string;
    timestamp: string;
    message: string;
    tags?: string[];
}

const LOG_FILE = path.join(os.homedir(), '.spidersan', 'sessions.json');

function ensureLogFile(): SessionLog[] {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '[]', 'utf-8');
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

function saveLog(logs: SessionLog[]): void {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

function generateId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const logCommand = new Command('log')
    .description('Record multi-agent collaboration sessions')
    .argument('[message]', 'Session description to log')
    .option('--list', 'List all logged sessions')
    .option('--last <n>', 'Show last N sessions', '10')
    .option('--tags <tags>', 'Comma-separated tags for the session')
    .option('--json', 'Output as JSON')
    .option('--clear', 'Clear all session logs')
    .action(async (message, options) => {
        const logs = ensureLogFile();

        // Clear logs
        if (options.clear) {
            saveLog([]);
            console.log('🕷️ Session logs cleared.');
            return;
        }

        // List mode
        if (options.list || !message) {
            if (logs.length === 0) {
                console.log('🕷️ No sessions logged yet.');
                console.log('   Run: spidersan log "Your session description"');
                return;
            }

            const limit = parseInt(options.last, 10) || 10;
            const recent = logs.slice(-limit).reverse();

            if (options.json) {
                console.log(JSON.stringify(recent, null, 2));
                return;
            }

            console.log('🕷️ Session History:\n');
            for (const session of recent) {
                const date = new Date(session.timestamp).toLocaleString();
                const tags = session.tags?.length ? ` [${session.tags.join(', ')}]` : '';
                console.log(`  📝 ${date}${tags}`);
                console.log(`     ${session.message}`);
                console.log(`     ID: ${session.id}\n`);
            }
            console.log(`Showing ${recent.length} of ${logs.length} sessions.`);
            return;
        }

        // Add new log
        const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
        const newLog: SessionLog = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            message,
            tags: tags.length > 0 ? tags : undefined
        };

        logs.push(newLog);
        saveLog(logs);

        if (options.json) {
            console.log(JSON.stringify(newLog, null, 2));
            return;
        }

        console.log('🕷️ Session logged!');
        console.log(`   ID: ${newLog.id}`);
        console.log(`   Message: ${message}`);
        if (tags.length > 0) {
            console.log(`   Tags: ${tags.join(', ')}`);
        }
        console.log(`\n   Total sessions: ${logs.length}`);
    });
