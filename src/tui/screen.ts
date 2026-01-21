/**
 * Spidersan TUI - Terminal User Interface
 * Interactive dashboard for branch coordination
 */

import blessed from 'blessed';
import { getStorage } from '../storage/index.js';

export class SpidersanTUI {
    private screen: blessed.Widgets.Screen;
    private panels: { [key: string]: blessed.Widgets.BoxElement } = {};

    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: '🕷️ Spidersan Dashboard',
        });

        // Quit keys
        this.screen.key(['q', 'escape', 'C-c'], () => {
            return process.exit(0);
        });

        this.createPanels();
    }

    private createPanel(options: blessed.Widgets.BoxOptions): blessed.Widgets.BoxElement {
        const panel = blessed.box({
            ...options,
            border: { type: 'line' },
            style: {
                border: { fg: 'cyan' },
            },
            tags: true,
            scrollable: true,
            alwaysScroll: true,
        });

        this.screen.append(panel);
        return panel;
    }

    private createPanels() {
        // Top-left: Active Branches
        this.panels.branches = this.createPanel({
            top: 0,
            left: 0,
            width: '50%',
            height: '33%',
            label: ' 🕷️ Active Branches ',
        });

        // Top-right: Symbol Locks
        this.panels.locks = this.createPanel({
            top: 0,
            left: '50%',
            width: '50%',
            height: '33%',
            label: ' 🔒 Symbol Locks ',
        });

        // Middle-left: Merge Order
        this.panels.merge = this.createPanel({
            top: '33%',
            left: 0,
            width: '50%',
            height: '33%',
            label: ' 🔄 Merge Order ',
        });

        // Middle-right: Intent Log
        this.panels.intents = this.createPanel({
            top: '33%',
            left: '50%',
            width: '50%',
            height: '33%',
            label: ' 📝 Intent Log ',
        });

        // Bottom: Conflict Map
        this.panels.conflicts = this.createPanel({
            top: '66%',
            left: 0,
            width: '100%',
            height: '28%',
            label: ' ⚠️ Conflict Map ',
        });

        // Status bar
        this.panels.status = this.createPanel({
            top: '94%',
            left: 0,
            width: '100%',
            height: '6%',
            label: '',
        });
    }

    async refresh() {
        const storage = await getStorage();

        // Branches panel
        try {
            const branches = await storage.list();
            let content = '';

            for (const branch of branches) {
                const status = branch.status === 'active' ? '🟢' : '🔴';
                content += `${status} {bold}${branch.name}{/bold}\n`;
                content += `   Agent: ${branch.agent || 'unknown'}\n`;
                const files = branch.files?.slice(0, 3) || [];
                if (files.length > 0) {
                    content += `   Files: ${files.join(', ')}\n`;
                }
                content += '\n';
            }

            this.panels.branches.setContent(content || 'No active branches');
        } catch {
            this.panels.branches.setContent('Error loading branches');
        }

        // Locks panel (from CRDT state)
        this.panels.locks.setContent('🔒 Symbol locks will appear here\nRun: spidersan lock --list');

        // Merge order
        this.panels.merge.setContent('🔄 Merge sequence:\n1. → 2. → 3.\n(Run spidersan merge-order for details)');

        // Intent log
        this.panels.intents.setContent('📝 Agent intents:\n• sherlocksan: "Security review"\n• gemini: "AST implementation"');

        // Conflicts
        this.panels.conflicts.setContent('⚠️ Conflicts:\n(Run spidersan conflicts --semantic for analysis)');

        // Status bar
        const time = new Date().toLocaleTimeString();
        this.panels.status.setContent(`{center}[L]ocks [C]onflicts [R]efresh [Q]uit | Last update: ${time}{/center}`);

        this.screen.render();
    }

    start() {
        // Initial render
        this.refresh();

        // Auto-refresh every 5 seconds
        setInterval(() => this.refresh(), 5000);

        // Keyboard shortcuts
        this.screen.key(['r'], () => this.refresh());

        this.screen.key(['l'], () => {
            this.panels.locks.focus();
            this.screen.render();
        });

        this.screen.key(['c'], () => {
            this.panels.conflicts.focus();
            this.screen.render();
        });
    }
}
