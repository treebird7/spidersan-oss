import blessed from 'blessed';
import { escapeBlessed } from '../lib/security.js';

interface DashboardState {
    connectedAgents: string[];
    activeTasks: Array<{ id: string; title: string; owner: string; status: string }>;
    activeFiles: Map<string, string[]>; // file -> agents[]
    activeLocks: Array<{ symbol: string; agent: string; time: number }>; // NEW
    logs: string[];
}

export class SpidersanDashboard {
    private screen: blessed.Widgets.Screen;
    private headerBox: blessed.Widgets.BoxElement;
    private taskList: blessed.Widgets.ListElement;
    private radarBox: blessed.Widgets.BoxElement;
    private locksBox: blessed.Widgets.ListElement; // NEW
    private logBox: blessed.Widgets.ListElement;
    private state: DashboardState;

    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: '🕷️ Spidersan Monitor'
        });

        this.state = {
            connectedAgents: [],
            activeTasks: [],
            activeFiles: new Map(),
            activeLocks: [],
            logs: []
        };

        // --- Layout ---

        // 1. Header (Top)
        this.headerBox = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: '🕷️ SPIDERSAN MONITOR | initializing...',
            tags: true,
            style: {
                fg: 'white',
                bg: 'blue',
                bold: true
            }
        });

        // 2. Task List (Left Top)
        const taskBox = blessed.box({
            top: 3,
            left: 0,
            width: '50%',
            height: '40%', // Reduced height
            label: ' 📋 ACTIVE TASKS ',
            border: { type: 'line' },
            style: { border: { fg: 'green' } }
        });

        this.taskList = blessed.list({
            parent: taskBox,
            top: 0,
            left: 0,
            width: '100%-2',
            height: '100%-2',
            keys: true,
            mouse: true,
            tags: true,
            style: {
                selected: { bg: 'green', fg: 'black' }
            }
        });

        // 2.5 Locks List (Left Bottom) - NEW
        const locksContainer = blessed.box({
            top: '40%+3',
            left: 0,
            width: '50%',
            height: '30%',
            label: ' 🔒 ACTIVE LOCKS ',
            border: { type: 'line' },
            style: { border: { fg: 'yellow' } }
        });

        this.locksBox = blessed.list({
            parent: locksContainer,
            top: 0,
            left: 0,
            width: '100%-2',
            height: '100%-2',
            tags: true
        });

        // 3. Conflict Radar (Right)
        this.radarBox = blessed.box({
            top: 3,
            left: '50%',
            width: '50%',
            height: '70%',
            label: ' 🕸️ CONFLICT RADAR ',
            border: { type: 'line' },
            tags: true,
            style: { border: { fg: 'red' } }
        });

        // 4. Logs (Bottom)
        const logContainer = blessed.box({
            top: '70%+3',
            left: 0,
            width: '100%',
            height: '30%-3',
            label: ' 📜 SYSTEM LOGS ',
            border: { type: 'line' },
            style: { border: { fg: 'cyan' } }
        });

        this.logBox = blessed.list({
            parent: logContainer,
            top: 0,
            left: 0,
            width: '100%-2',
            height: '100%-2',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: ' ',
                track: { bg: 'grey' },
                style: { bg: 'cyan' }
            }
        });

        // Append everything
        this.screen.append(this.headerBox);
        this.screen.append(taskBox);
        this.screen.append(locksContainer); // NEW
        this.screen.append(this.radarBox);
        this.screen.append(logContainer);

        // Key bindings
        this.screen.key(['escape', 'q', 'C-c'], () => {
            return process.exit(0);
        });
    }

    public render() {
        this.updateHeader();
        this.updateTasks();
        this.updateLocks(); // NEW
        this.updateRadar();
        // Logs are appended incrementally
        this.screen.render();
    }

    private updateHeader() {
        const time = new Date().toLocaleTimeString();
        // Security: Escape agent names to prevent markup injection
        const safeAgents = this.state.connectedAgents.map(a => escapeBlessed(a));
        const agents = safeAgents.join(', ') || 'Waiting for heartbeats...';
        this.headerBox.setContent(
            ` 🕷️ SPIDERSAN MONITOR  |  🕒 ${time}\n` +
            ` 📡 AGENTS: ${agents}`
        );
    }

    private updateLocks() {
        if (this.state.activeLocks.length === 0) {
            this.locksBox.setItems(['(No active locks)']);
            return;
        }

        const items = this.state.activeLocks.map(l => {
            const age = Math.floor((Date.now() - l.time) / 1000 / 60);
            // Security: Escape dynamic content
            return `🔒 ${escapeBlessed(l.symbol)} ({yellow-fg}${escapeBlessed(l.agent)}{/}) - ${age}m`;
        });
        this.locksBox.setItems(items);
    }

    private updateTasks() {
        const items = this.state.activeTasks.map(t => {
            const statusIcon = t.status === 'implementing' ? '⚙️' : '⏳';
            // Security: Escape dynamic content
            return `${statusIcon} [${escapeBlessed(t.title)}] - ${escapeBlessed(t.owner)}`;
        });

        if (items.length === 0) {
            this.taskList.setItems(['(No active tasks)']);
        } else {
            this.taskList.setItems(items);
        }
    }

    private updateRadar() {
        // Simple visualization: List conflicting files with red agents
        let content = '';

        if (this.state.activeFiles.size === 0) {
            content = '{center}✨ No active file locks{/center}';
        } else {
            this.state.activeFiles.forEach((agents, file) => {
                const isConflict = agents.length > 1;
                const color = isConflict ? '{red-fg}' : '{green-fg}';
                const icon = isConflict ? '🔴' : '🟢';

                // Security: Escape dynamic content
                const safeFile = escapeBlessed(file);
                const safeAgents = agents.map(a => escapeBlessed(a)).join(', ');

                content += `${color}${icon} ${safeFile}{/}\n`;
                content += `   └─ 👥 ${safeAgents}\n\n`;
            });
        }

        this.radarBox.setContent(content);
    }

    public updateState(updates: Partial<DashboardState>) {
        this.state = { ...this.state, ...updates };
        this.render();
    }

    public addLog(message: string) {
        const time = new Date().toLocaleTimeString();
        // Security: Escape log message
        this.logBox.add(`${time} | ${escapeBlessed(message)}`);
        this.logBox.scrollTo(this.logBox.getLines().length); // Scroll to bottom
        this.screen.render();
    }
}
