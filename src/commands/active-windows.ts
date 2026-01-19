/**
 * spidersan active-windows
 * 
 * Layer 4: Temporal Conflict Detection
 * 
 * Tracks when agents are actively working and detects
 * overlapping work sessions on the same files/areas.
 * 
 * Usage:
 *   spidersan active-windows           # Show current active sessions
 *   spidersan active-windows --history # Show recent session overlaps
 *   spidersan active-windows --files   # Group by files touched
 */

import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

// Represents an active work window
interface WorkWindow {
    agent: string;
    machine: string;
    startTime: Date;
    endTime: Date | null;  // null = still active
    filesModified: string[];
    areasWorked: string[];  // directories/components
}

// Overlap between two windows
interface WindowOverlap {
    window1: WorkWindow;
    window2: WorkWindow;
    overlapMinutes: number;
    sharedFiles: string[];
    sharedAreas: string[];
    severity: 'safe' | 'warn' | 'conflict';
}

// Parse collab for dawn/close entries
function findSessionBoundaries(collabDir: string): Map<string, { dawn?: Date; close?: Date }[]> {
    const sessions = new Map<string, { dawn?: Date; close?: Date }[]>();

    const files = readdirSync(collabDir)
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-daily\.md$/))
        .sort()
        .slice(-3);  // Last 3 days

    for (const file of files) {
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) continue;

        const dateStr = dateMatch[1];
        const content = readFileSync(join(collabDir, file), 'utf-8');

        // Find agent entries with times
        const entryPattern = /^##\s+([\p{Emoji}]+)\s+(\w+)\s*[—-]\s*(\d{1,2}):(\d{2})/gmu;
        let match;

        while ((match = entryPattern.exec(content)) !== null) {
            const agent = match[2];
            const hour = parseInt(match[3]);
            const minute = parseInt(match[4]);

            const entryTime = new Date(`${dateStr}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`);

            // Check if it's a dawn or close entry
            const contextStart = match.index;
            const contextEnd = Math.min(content.length, contextStart + 500);
            const context = content.substring(contextStart, contextEnd).toLowerCase();

            if (!sessions.has(agent)) {
                sessions.set(agent, []);
            }

            const agentSessions = sessions.get(agent)!;

            if (context.includes('dawn') || context.includes('morning') || context.includes('joining')) {
                // Start of session
                agentSessions.push({ dawn: entryTime });
            } else if (context.includes('close') || context.includes('closing') || context.includes('night')) {
                // End of session
                const lastSession = agentSessions[agentSessions.length - 1];
                if (lastSession && !lastSession.close) {
                    lastSession.close = entryTime;
                }
            }
        }
    }

    return sessions;
}

// Get recent git activity per author
function getGitActivity(repoPath: string, hours: number): Map<string, { files: string[]; timestamp: Date }[]> {
    const activity = new Map<string, { files: string[]; timestamp: Date }[]>();

    try {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const sinceStr = since.toISOString();

        // Get commits with files changed
        const log = execSync(
            `git log --since="${sinceStr}" --name-only --pretty=format:"COMMIT:%h|%an|%ai" 2>/dev/null`,
            { cwd: repoPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );

        const lines = log.split('\n');
        let currentAuthor = '';
        let currentTime: Date | null = null;
        let currentFiles: string[] = [];

        for (const line of lines) {
            if (line.startsWith('COMMIT:')) {
                // Save previous commit
                if (currentAuthor && currentFiles.length > 0 && currentTime) {
                    if (!activity.has(currentAuthor)) {
                        activity.set(currentAuthor, []);
                    }
                    activity.get(currentAuthor)!.push({
                        files: [...currentFiles],
                        timestamp: currentTime
                    });
                }

                // Parse new commit
                const parts = line.substring(7).split('|');
                currentAuthor = parts[1] || 'Unknown';
                currentTime = new Date(parts[2]);
                currentFiles = [];
            } else if (line.trim()) {
                currentFiles.push(line.trim());
            }
        }

        // Don't forget last commit
        if (currentAuthor && currentFiles.length > 0 && currentTime) {
            if (!activity.has(currentAuthor)) {
                activity.set(currentAuthor, []);
            }
            activity.get(currentAuthor)!.push({
                files: [...currentFiles],
                timestamp: currentTime
            });
        }
    } catch (e) {
        // Not a git repo or no commits
    }

    return activity;
}

// Build work windows from git activity
function buildWorkWindows(repoPath: string, hours: number): WorkWindow[] {
    const activity = getGitActivity(repoPath, hours);
    const windows: WorkWindow[] = [];

    // Get machine name from hostname
    let machine = 'Unknown';
    try {
        machine = execSync('hostname', { encoding: 'utf-8' }).trim();
    } catch {
        // Ignore errors getting hostname
    }

    for (const [author, commits] of activity) {
        if (commits.length === 0) continue;

        // Sort by time
        commits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Group commits into windows (gap > 30 min = new window)
        let windowStart = commits[0].timestamp;
        let windowEnd = commits[0].timestamp;
        let windowFiles: Set<string> = new Set(commits[0].files);

        for (let i = 1; i < commits.length; i++) {
            const gap = commits[i].timestamp.getTime() - windowEnd.getTime();

            if (gap > 30 * 60 * 1000) {  // 30 min gap
                // Save current window
                windows.push({
                    agent: author,
                    machine,
                    startTime: windowStart,
                    endTime: windowEnd,
                    filesModified: Array.from(windowFiles),
                    areasWorked: extractAreas(Array.from(windowFiles))
                });

                // Start new window
                windowStart = commits[i].timestamp;
                windowEnd = commits[i].timestamp;
                windowFiles = new Set(commits[i].files);
            } else {
                windowEnd = commits[i].timestamp;
                commits[i].files.forEach(f => windowFiles.add(f));
            }
        }

        // Check if last window is still active (last commit < 2 hours ago)
        const isActive = Date.now() - windowEnd.getTime() < 2 * 60 * 60 * 1000;

        windows.push({
            agent: author,
            machine,
            startTime: windowStart,
            endTime: isActive ? null : windowEnd,
            filesModified: Array.from(windowFiles),
            areasWorked: extractAreas(Array.from(windowFiles))
        });
    }

    return windows;
}

function extractAreas(files: string[]): string[] {
    const areas = new Set<string>();

    for (const file of files) {
        const parts = file.split('/');
        if (parts.length > 1) {
            areas.add(parts[0]);  // Top level directory
            if (parts.length > 2) {
                areas.add(`${parts[0]}/${parts[1]}`);  // Second level
            }
        }
    }

    return Array.from(areas);
}

function findWindowOverlaps(windows: WorkWindow[]): WindowOverlap[] {
    const overlaps: WindowOverlap[] = [];

    for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
            const w1 = windows[i];
            const w2 = windows[j];

            // Same agent can't conflict with self
            if (w1.agent === w2.agent) continue;

            // Calculate time overlap
            const start1 = w1.startTime.getTime();
            const end1 = (w1.endTime || new Date()).getTime();
            const start2 = w2.startTime.getTime();
            const end2 = (w2.endTime || new Date()).getTime();

            const overlapStart = Math.max(start1, start2);
            const overlapEnd = Math.min(end1, end2);

            if (overlapStart >= overlapEnd) continue;  // No time overlap

            const overlapMinutes = Math.round((overlapEnd - overlapStart) / (60 * 1000));

            // Check file/area overlap
            const sharedFiles = w1.filesModified.filter(f => w2.filesModified.includes(f));
            const sharedAreas = w1.areasWorked.filter(a => w2.areasWorked.includes(a));

            // Determine severity
            let severity: WindowOverlap['severity'] = 'safe';
            if (sharedFiles.length > 0) {
                severity = 'conflict';
            } else if (sharedAreas.length > 0) {
                severity = 'warn';
            }

            if (severity !== 'safe') {
                overlaps.push({
                    window1: w1,
                    window2: w2,
                    overlapMinutes,
                    sharedFiles,
                    sharedAreas,
                    severity
                });
            }
        }
    }

    return overlaps.sort((a, b) => {
        if (a.severity === 'conflict' && b.severity !== 'conflict') return -1;
        if (b.severity === 'conflict' && a.severity !== 'conflict') return 1;
        return b.overlapMinutes - a.overlapMinutes;
    });
}

function formatDuration(start: Date, end: Date | null): string {
    const endTime = end || new Date();
    const minutes = Math.round((endTime.getTime() - start.getTime()) / (60 * 1000));

    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const activeWindowsCommand = new Command('active-windows')
    .description('Detect overlapping work sessions (Layer 4)')
    .option('--hours <n>', 'Hours to look back', '24')
    .option('--repo <path>', 'Repository to analyze', process.cwd())
    .option('--json', 'Output as JSON')
    .option('--files', 'Group by files touched')
    .option('--all-repos', 'Scan all /Dev repositories')
    .addHelpText('after', `
Examples:
  spidersan active-windows              # Show sessions in current repo
  spidersan active-windows --hours 48   # Look back 48 hours
  spidersan active-windows --all-repos  # Scan all repos
  spidersan active-windows --files      # Show files per session

Layer 4 of Spidersan's 7-layer conflict detection:
  L1: File-level (git conflicts)
  L2: Semantic (code dependencies)
  L3: Intent (collab entries)
  L4: Temporal (active windows) ← THIS
  L5: Cross-repo (breaking changes)
  L6: Predictive (pattern analysis)
  L7: Resolution (auto-merge)
`)
    .action((options) => {
        const hours = parseInt(options.hours) || 24;
        const isJson = options.json;

        let allWindows: WorkWindow[] = [];

        if (options.allRepos) {
            // Scan all /Dev repos
            const devDir = join(process.env.HOME || '', 'Dev');
            if (existsSync(devDir)) {
                const repos = readdirSync(devDir)
                    .filter(d => existsSync(join(devDir, d, '.git')));

                for (const repo of repos) {
                    const repoPath = join(devDir, repo);
                    const windows = buildWorkWindows(repoPath, hours);
                    // Tag windows with repo name
                    windows.forEach(w => {
                        w.areasWorked = w.areasWorked.map(a => `${repo}/${a}`);
                        w.filesModified = w.filesModified.map(f => `${repo}/${f}`);
                    });
                    allWindows.push(...windows);
                }
            }
        } else {
            allWindows = buildWorkWindows(options.repo, hours);
        }

        // Find overlaps
        const overlaps = findWindowOverlaps(allWindows);

        if (isJson) {
            console.log(JSON.stringify({
                windows: allWindows.map(w => ({
                    ...w,
                    startTime: w.startTime.toISOString(),
                    endTime: w.endTime?.toISOString() || null
                })),
                overlaps: overlaps.map(o => ({
                    ...o,
                    window1: {
                        agent: o.window1.agent,
                        startTime: o.window1.startTime.toISOString()
                    },
                    window2: {
                        agent: o.window2.agent,
                        startTime: o.window2.startTime.toISOString()
                    }
                })),
                summary: {
                    totalWindows: allWindows.length,
                    activeNow: allWindows.filter(w => !w.endTime).length,
                    conflicts: overlaps.filter(o => o.severity === 'conflict').length,
                    warnings: overlaps.filter(o => o.severity === 'warn').length
                }
            }, null, 2));
            return;
        }

        console.log(chalk.bold('\n🕷️ ACTIVE WINDOWS — Layer 4 Conflict Detection\n'));

        // Show active sessions
        const active = allWindows.filter(w => !w.endTime);
        const recent = allWindows.filter(w => w.endTime);

        if (active.length > 0) {
            console.log(chalk.bold.green('🟢 Currently Active:\n'));
            for (const w of active) {
                console.log(`  ${chalk.cyan(w.agent)} (${w.machine})`);
                console.log(`    Started: ${formatTime(w.startTime)} (${formatDuration(w.startTime, null)} ago)`);
                console.log(`    Areas: ${chalk.gray(w.areasWorked.join(', ') || 'none')}`);
                if (options.files && w.filesModified.length > 0) {
                    console.log(`    Files: ${chalk.gray(w.filesModified.slice(0, 5).join(', '))}`);
                }
                console.log();
            }
        } else {
            console.log(chalk.gray('No active sessions detected\n'));
        }

        // Show recent sessions
        if (recent.length > 0) {
            console.log(chalk.bold('📊 Recent Sessions:\n'));
            for (const w of recent.slice(-10)) {
                console.log(`  ${chalk.cyan(w.agent)} (${w.machine})`);
                console.log(`    ${formatTime(w.startTime)} - ${formatTime(w.endTime!)} (${formatDuration(w.startTime, w.endTime)})`);
                console.log(`    Areas: ${chalk.gray(w.areasWorked.join(', ') || 'none')}`);
                console.log();
            }
        }

        // Show overlaps
        if (overlaps.length > 0) {
            console.log(chalk.bold.yellow('\n⚠️  Session Overlaps Detected:\n'));

            for (const overlap of overlaps) {
                const icon = overlap.severity === 'conflict' ? '🔴' : '🟠';
                const label = overlap.severity === 'conflict' ? 'FILE CONFLICT' : 'AREA OVERLAP';

                console.log(`${icon} ${chalk.bold(label)} (${overlap.overlapMinutes} min overlap)`);
                console.log(`  ${chalk.cyan(overlap.window1.agent)} ↔ ${chalk.cyan(overlap.window2.agent)}`);

                if (overlap.sharedFiles.length > 0) {
                    console.log(`  Shared files: ${chalk.red(overlap.sharedFiles.join(', '))}`);
                }
                if (overlap.sharedAreas.length > 0) {
                    console.log(`  Shared areas: ${chalk.yellow(overlap.sharedAreas.join(', '))}`);
                }
                console.log();
            }
        } else {
            console.log(chalk.green('\n✅ No overlapping sessions detected\n'));
        }

        // Summary
        console.log(chalk.gray(`Scanned ${hours}h of activity, found ${allWindows.length} session(s)\n`));
    });
