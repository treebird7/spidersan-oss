import blessed from 'blessed';

interface DashboardState {
    connectedAgents: string[];
    activeTasks: Array<{ id: string; title: string; owner: string; status: string }>;
    activeFiles: Map<string, string[]>; // file -> agents[]
    logs: string[];
}

export class SpidersanDashboard {
    private screen: blessed.Widgets.Screen;
    private headerBox: blessed.Widgets.BoxElement;
    private taskList: blessed.Widgets.ListElement;
    private radarBox: blessed.Widgets.BoxElement;
    private logBox: blessed.Widgets.ListElement; // Changed to ListElement for better scrolling
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
            logs: []
        };

        // --- Layout ---

        // 1. Header (Top)
        this.headerBox = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 3, // Increased height
            content: '🕷️ SPIDERSAN MONITOR | initializing...',
            tags: true,
            style: {
                fg: 'white',
                bg: 'blue',
                bold: true
            }
        });

        // 2. Task List (Left)
        const taskBox = blessed.box({
            top: 3,
            left: 0,
            width: '50%',
            height: '50%-3', // Subtract header height
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

        // 3. Conflict Radar (Right)
        this.radarBox = blessed.box({
            top: 3,
            left: '50%',
            width: '50%',
            height: '50%-3',
            label: ' 🕸️ CONFLICT RADAR ',
            border: { type: 'line' },
            tags: true,
            style: { border: { fg: 'red' } }
        });

        // 4. Logs (Bottom)
        const logContainer = blessed.box({
            top: '50%',
            left: 0,
            width: '100%',
            height: '50%',
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
        this.updateRadar();
        // Logs are appended incrementally, so no full re-render needed for them usually
        this.screen.render();
    }

    private updateHeader() {
        const time = new Date().toLocaleTimeString();
        const agents = this.state.connectedAgents.join(', ') || 'Waiting for heartbeats...';
        this.headerBox.setContent(
            ` 🕷️ SPIDERSAN MONITOR  |  🕒 ${time}\n` +
            ` 📡 AGENTS: ${agents}`
        );
    }

    private updateTasks() {
        const items = this.state.activeTasks.map(t => {
            const statusIcon = t.status === 'implementing' ? '⚙️' : '⏳';
            return `${statusIcon} [${t.title}] - ${t.owner}`;
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

                content += `${color}${icon} ${file}{/}\n`;
                content += `   └─ 👥 ${agents.join(', ')}\n\n`;
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
        this.logBox.add(`${time} | ${message}`);
        this.logBox.scrollTo(this.logBox.getLines().length); // Scroll to bottom
        this.screen.render();
    }
}
