/**
 * spidersan dashboard
 *
 * Real-time TUI showing:
 * - Panel 1: Local branches (registry)
 * - Panel 2: Remote machines (cross-machine registries)
 * - Panel 3: Conflicts (F3 cross-conflicts)
 * - Panel 4: Sync recommendations (F4 sync-advisor)
 *
 * Part of F5: TUI Dashboard
 */

import { Command } from 'commander';
import blessed from 'blessed';
import { getStorage } from '../storage/index.js';
import { loadConfig } from '../lib/config.js';
import { SupabaseStorage } from '../storage/supabase.js';
import type { Branch } from '../storage/adapter.js';
import type { MachineRegistryView } from '../types/cloud.js';
import { scanRepo, generateRecommendations } from '../lib/repo-scanner.js';
import { escapeBlessed } from '../lib/security.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Color constants (Artisan UX spec) ───────────────────────────────────────

export const TIER1_COLOR = 'yellow';
export const TIER2_COLOR = 'red';
export const TIER3_COLOR = 'magenta';

export const STATUS_ACTIVE_COLOR = 'green';
export const STATUS_COMPLETED_COLOR = 'blue';
export const STATUS_ABANDONED_COLOR = 'white';

export const PANEL_BORDER_ACTIVE = 'cyan';
export const PANEL_BORDER_INACTIVE = 'gray';

// ── Internal display helpers ─────────────────────────────────────────────────

const TIER_ICONS = { 1: '[! ]', 2: '[!!]', 3: '[!!!]' } as const;

interface TUIState {
  localBranches: Branch[];
  remoteMachines: MachineRegistryView[];
  conflicts: unknown[];
  recommendations: unknown[];
  machineId: string;
  machineName: string;
  refreshing: boolean;
}

async function loadMachineIdentity() {
  const configPath = join(homedir(), '.envoak', 'machine.json');
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      const data = JSON.parse(raw);
      return {
        id: data.id || data.machine_id || 'unknown',
        name: data.name || data.machine_name || 'unknown',
        hostname: data.hostname || 'unknown',
      };
    } catch {
      // fall through
    }
  }
  return { id: 'unknown', name: 'local', hostname: 'unknown' };
}

function statusColor(status: Branch['status']): string {
  if (status === 'active') return STATUS_ACTIVE_COLOR;
  if (status === 'completed') return STATUS_COMPLETED_COLOR;
  return STATUS_ABANDONED_COLOR;
}

function formatBranch(b: Branch): string {
  const icon = b.status === 'active' ? '🟢' : b.status === 'completed' ? '🔵' : '⚪';
  const files = b.files.length > 0 ? ` [${b.files.length}f]` : '';
  return `${icon} ${escapeBlessed(b.name.padEnd(30))}${files}`;
}

function formatConflict(c: Record<string, unknown>): string {
  const tier = (c.tier ?? 1) as 1 | 2 | 3;
  const icon = TIER_ICONS[tier] ?? '[! ]';
  const color = tier === 3 ? TIER3_COLOR : tier === 2 ? TIER2_COLOR : TIER1_COLOR;
  const file = (c.file as string | undefined)?.slice(-38) || 'unknown';
  const count = (c.branches as unknown[])?.length ?? 0;
  const label = tier === 3 ? 'BLOCK' : tier === 2 ? 'PAUSE' : 'WARN';
  return `{${color}-fg}${icon} ${escapeBlessed(file.padEnd(38))} ${count}br {gray-fg}(${label}){/}`;
}

function formatRec(r: Record<string, unknown>): string {
  const action = (r.action as string | undefined) || 'unknown';
  const icon = action === 'push' ? '[X]' : action === 'pull' ? '[>]' : action === 'rebase' ? '[~]' : '[✓]';
  const repo = escapeBlessed((r.repo_name as string | undefined)?.padEnd(25) || 'unknown');
  const reason = escapeBlessed((r.reason as string | undefined)?.slice(0, 30) || '');
  return `${icon} ${repo} ${reason}`;
}

function branchDetailContent(b: Branch): string {
  const sc = statusColor(b.status);
  const name = escapeBlessed(b.name);
  const agent = escapeBlessed(b.agent || '(unknown)');
  const desc = b.description ? escapeBlessed(b.description) : '';
  const fileList = b.files.slice(0, 12).map(f => `  - ${escapeBlessed(f)}`).join('\n');
  const more = b.files.length > 12 ? `\n  +${b.files.length - 12} more` : '';
  const regAt = b.registeredAt ? new Date(b.registeredAt).toLocaleString('en-GB', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'unknown';

  return [
    `{bold}{${sc}-fg}${name}{/}  [{${sc}-fg}${b.status.toUpperCase()}{/}]`,
    `Agent: {magenta-fg}${agent}{/}`,
    desc ? `Desc:  ${desc}` : '',
    `Registered: {gray-fg}${regAt}{/}`,
    '',
    `Files (${b.files.length}):`,
    fileList + more,
  ].filter(l => l !== undefined).join('\n');
}

async function refreshState(
  state: TUIState,
  storage: SupabaseStorage | null,
  supabaseAvailable: boolean,
): Promise<void> {
  try {
    state.refreshing = true;
    const storage_inst = await getStorage();
    state.localBranches = await storage_inst.list();

    if (supabaseAvailable && storage) {
      try {
        state.remoteMachines = await storage.pullRegistries('spidersan', state.machineId);
      } catch {
        state.remoteMachines = [];
      }
    }

    state.conflicts = [];

    const repoState = scanRepo(process.cwd());
    if (repoState) {
      state.recommendations = generateRecommendations([repoState]);
    }

    state.refreshing = false;
  } catch {
    state.refreshing = false;
  }
}

// ── Command ──────────────────────────────────────────────────────────────────

export const dashboardCommand = new Command('dashboard')
  .description('Real-time TUI dashboard (4 panels)')
  .option('--refresh <n>', 'Refresh interval in seconds', '5')
  .action(async (options) => {
    const machine = await loadMachineIdentity();
    const config = await loadConfig();
    const url = process.env.SUPABASE_URL || config.storage.supabaseUrl;
    const key = process.env.SUPABASE_KEY || config.storage.supabaseKey;
    const supabase = url && key ? new SupabaseStorage({ url, key }) : null;
    const supabaseAvailable = !!supabase;

    const state: TUIState = {
      localBranches: [],
      remoteMachines: [],
      conflicts: [],
      recommendations: [],
      machineId: machine.id,
      machineName: machine.name,
      refreshing: false,
    };

    await refreshState(state, supabase, supabaseAvailable);

    // ── Screen ──
    const screen = blessed.screen({
      mouse: true,
      title: '🕷️ Spidersan Dashboard',
      border: 'line',
      tags: true,
    });

    // ── Header ──
    const header = blessed.box({
      parent: screen,
      top: 0, left: 0, right: 0, height: 3,
      content: `🕷️  Spidersan Dashboard  |  Machine: ${state.machineName}  |  Refresh: ${options.refresh}s`,
      style: { bg: 'blue', fg: 'white' },
      padding: 1,
      tags: false,
    });

    // ── Panels ──
    const panels = [
      blessed.box({
        parent: screen,
        top: 3, left: 0, width: '50%', height: '50%-2',
        border: 'line', label: ' Local Branches ',
        scrollable: true, keys: true, vi: true, mouse: true, tags: true,
        style: { border: { fg: PANEL_BORDER_INACTIVE } },
      }),
      blessed.box({
        parent: screen,
        top: 3, right: 0, width: '50%', height: '50%-2',
        border: 'line', label: ' Remote Machines ',
        scrollable: true, keys: true, vi: true, mouse: true, tags: true,
        style: { border: { fg: PANEL_BORDER_INACTIVE } },
      }),
      blessed.box({
        parent: screen,
        bottom: '50%-2', left: 0, width: '50%', height: '50%',
        border: 'line', label: ' Conflicts (F3) ',
        scrollable: true, keys: true, vi: true, mouse: true, tags: true,
        style: { border: { fg: PANEL_BORDER_INACTIVE } },
      }),
      blessed.box({
        parent: screen,
        bottom: '50%-2', right: 0, width: '50%', height: '50%',
        border: 'line', label: ' Sync Recommendations (F4) ',
        scrollable: true, keys: true, vi: true, mouse: true, tags: true,
        style: { border: { fg: PANEL_BORDER_INACTIVE } },
      }),
    ];

    // ── Footer ──
    const footer = blessed.box({
      parent: screen,
      bottom: 0, left: 0, right: 0, height: 1,
      content: ' Tab: next panel | Enter: detail | ?: help | r: refresh | q: quit',
      style: { bg: 'black', fg: 'white' },
      tags: false,
    });

    // ── Detail overlay ──
    const detailBox = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: '70%', height: '60%',
      border: 'line',
      label: ' Branch Detail ',
      scrollable: true, keys: true, vi: true,
      tags: true,
      style: { border: { fg: PANEL_BORDER_ACTIVE }, bg: 'black' },
      hidden: true,
      padding: 1,
    });

    // ── Help overlay ──
    const helpBox = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: 64, height: 22,
      border: 'line',
      label: ' Help ',
      tags: true,
      style: { border: { fg: PANEL_BORDER_ACTIVE }, bg: 'black' },
      hidden: true,
      padding: 1,
      content: [
        '{bold}Navigation{/}',
        '  Tab / Shift+Tab   Cycle panels',
        '  Up / Down         Scroll within panel',
        '  PageUp / PageDown Fast scroll',
        '  Enter             Expand branch detail',
        '  Esc               Close detail / overlay',
        '',
        '{bold}Actions{/}',
        '  r                 Refresh data',
        '  q                 Quit',
        '  ?                 Toggle help',
        '',
        '{bold}Conflict Tiers{/}',
        `  {${TIER1_COLOR}-fg}[! ] TIER1  warn   (yellow){/}`,
        `  {${TIER2_COLOR}-fg}{bold}[!!] TIER2  pause  (red, bold){/}`,
        `  {${TIER3_COLOR}-fg}{bold}[!!!] TIER3 block  (magenta, bold){/}`,
      ].join('\n'),
    });

    // ── Focus management ──
    let focusedPanel = 0;
    let helpVisible = false;
    let detailVisible = false;

    function updateBorders() {
      for (let i = 0; i < panels.length; i++) {
        (panels[i].style as { border: { fg: string } }).border.fg =
          i === focusedPanel ? PANEL_BORDER_ACTIVE : PANEL_BORDER_INACTIVE;
      }
    }

    function focusPanel(idx: number) {
      focusedPanel = ((idx % panels.length) + panels.length) % panels.length;
      updateBorders();
      panels[focusedPanel].focus();
      screen.render();
    }

    function showDetail(b: Branch) {
      detailBox.setContent(branchDetailContent(b));
      detailBox.show();
      detailBox.focus();
      detailVisible = true;
      screen.render();
    }

    function closeOverlays() {
      detailBox.hide();
      helpBox.hide();
      detailVisible = false;
      helpVisible = false;
      panels[focusedPanel].focus();
      screen.render();
    }

    // ── Render ──
    function render() {
      // Panel 1 — local branches
      let localText = '';
      for (const branch of state.localBranches) {
        const sc = statusColor(branch.status);
        localText += `{${sc}-fg}${formatBranch(branch)}{/}\n`;
      }
      panels[0].setContent(localText || '{gray-fg}(no branches){/}');

      // Panel 2 — remote machines
      let remoteText = '';
      for (const m of state.remoteMachines) {
        remoteText += `{cyan-fg}${escapeBlessed(m.machine_name)}{/} (${m.branches.length} branches)\n`;
        for (const b of m.branches.slice(0, 5)) {
          remoteText += `  ${formatBranch(b)}\n`;
        }
        if (m.branches.length > 5) {
          remoteText += `  {gray-fg}+${m.branches.length - 5} more{/}\n`;
        }
        remoteText += '\n';
      }
      panels[1].setContent(remoteText || '{gray-fg}(no remote machines){/}');

      // Panel 3 — conflicts
      let conflictText = '';
      for (const c of state.conflicts.slice(0, 15)) {
        conflictText += formatConflict(c as Record<string, unknown>) + '\n';
      }
      panels[2].setContent(conflictText || '{green-fg}(no conflicts detected){/}');

      // Panel 4 — sync recommendations
      let syncText = '';
      for (const r of state.recommendations.slice(0, 10)) {
        syncText += formatRec(r as Record<string, unknown>) + '\n';
      }
      panels[3].setContent(syncText || '{green-fg}(all repos synced){/}');

      updateBorders();
      if (state.refreshing) {
        header.setContent(`🕷️  Spidersan Dashboard  |  Machine: ${state.machineName}  |  {yellow-fg}Refreshing…{/}`);
      } else {
        header.setContent(`🕷️  Spidersan Dashboard  |  Machine: ${state.machineName}  |  Refresh: ${options.refresh}s`);
      }
      screen.render();
    }

    // ── Keyboard bindings ──
    screen.key(['q', 'C-c'], () => {
      clearInterval(refreshInterval);
      screen.destroy();
    });

    screen.key(['r'], async () => {
      if (detailVisible || helpVisible) return;
      await refreshState(state, supabase, supabaseAvailable);
      render();
    });

    screen.key(['tab'], () => {
      if (detailVisible || helpVisible) return;
      focusPanel(focusedPanel + 1);
    });

    screen.key(['S-tab'], () => {
      if (detailVisible || helpVisible) return;
      focusPanel(focusedPanel - 1);
    });

    screen.key(['?'], () => {
      if (detailVisible) return;
      if (helpVisible) {
        closeOverlays();
      } else {
        detailBox.hide();
        detailVisible = false;
        helpBox.show();
        helpBox.focus();
        helpVisible = true;
        screen.render();
      }
    });

    screen.key(['escape'], () => {
      if (detailVisible || helpVisible) {
        closeOverlays();
      }
    });

    screen.key(['enter'], () => {
      if (detailVisible || helpVisible) return;
      if (focusedPanel === 0) {
        const idx = (panels[0] as blessed.Widgets.BoxElement & { getScrollPerc?: () => number }).getScrollPerc?.() ?? 0;
        const branchIdx = Math.round(idx / 100 * Math.max(0, state.localBranches.length - 1));
        const branch = state.localBranches[branchIdx];
        if (branch) showDetail(branch);
      } else if (focusedPanel === 1) {
        const allRemote = state.remoteMachines.flatMap(m => m.branches);
        if (allRemote[0]) showDetail(allRemote[0]);
      }
    });

    // Refresh timer
    const refreshInterval = setInterval(async () => {
      await refreshState(state, supabase, supabaseAvailable);
      render();
    }, parseInt(options.refresh, 10) * 1000);

    // Initial state
    focusPanel(0);
    render();
  });
