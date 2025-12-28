/**
 * spidersan audit-mark
 * 
 * Tag branches as security-reviewed by Sherlocksan (or other auditors).
 * Stores audit metadata in the branch description field as JSON prefix.
 * 
 * Part of: Security Pipeline (ssan + srlk)
 * See: treebird-internal/collab/DESIGN_security_pipeline_ssan_srlk.md
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';

interface AuditMark {
    reviewer: string;
    passed: boolean;
    timestamp: string;
    verdict: 'safe' | 'review' | 'block';
    audit_id?: string;
    notes?: string;
}

const AUDIT_MARK_PREFIX = '[AUDIT:';
const AUDIT_MARK_SUFFIX = ']';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function extractAuditMark(description?: string): AuditMark | null {
    if (!description) return null;

    const start = description.indexOf(AUDIT_MARK_PREFIX);
    if (start === -1) return null;

    const end = description.indexOf(AUDIT_MARK_SUFFIX, start);
    if (end === -1) return null;

    try {
        const json = description.substring(start + AUDIT_MARK_PREFIX.length, end);
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function injectAuditMark(description: string | undefined, mark: AuditMark | null): string {
    // Remove any existing audit mark
    let cleanDescription = description || '';
    const start = cleanDescription.indexOf(AUDIT_MARK_PREFIX);
    if (start !== -1) {
        const end = cleanDescription.indexOf(AUDIT_MARK_SUFFIX, start);
        if (end !== -1) {
            cleanDescription = (cleanDescription.substring(0, start) +
                cleanDescription.substring(end + AUDIT_MARK_SUFFIX.length)).trim();
        }
    }

    if (mark === null) {
        return cleanDescription;
    }

    // Add new audit mark
    const markStr = `${AUDIT_MARK_PREFIX}${JSON.stringify(mark)}${AUDIT_MARK_SUFFIX}`;
    return cleanDescription ? `${markStr} ${cleanDescription}` : markStr;
}

export const auditMarkCommand = new Command('audit-mark')
    .description('Tag a branch as security-reviewed (srlk integration)')
    .argument('[branch]', 'Branch to mark (default: current branch)')
    .option('--reviewer <agent>', 'Agent who performed the audit (default: srlk)', 'srlk')
    .option('--passed', 'Mark as passed security review')
    .option('--failed', 'Mark as failed security review')
    .option('--verdict <verdict>', 'Audit verdict: safe, review, block', 'safe')
    .option('--audit-id <id>', 'Reference to audit report ID')
    .option('--notes <text>', 'Additional notes about the audit')
    .option('--json', 'Output as JSON')
    .option('--unmark', 'Remove audit mark from branch')
    .option('--show', 'Show current audit mark without changing it')
    .action(async (branchArg, options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = branchArg || getCurrentBranch();
        const branch = await storage.get(branchName);

        if (!branch) {
            console.error(`❌ Branch "${branchName}" is not registered.`);
            console.error('   Run: spidersan register --files "..."');
            process.exit(1);
        }

        const existingMark = extractAuditMark(branch.description);

        // Handle --show
        if (options.show) {
            if (options.json) {
                console.log(JSON.stringify({
                    branch: branchName,
                    auditMark: existingMark,
                }, null, 2));
            } else if (existingMark) {
                const verdictEmoji = { safe: '✅', review: '⚠️', block: '🚫' };
                console.log('');
                console.log('🕷️  Audit Mark Status');
                console.log('');
                console.log(`   📍 Branch: ${branchName}`);
                console.log(`   ${verdictEmoji[existingMark.verdict]} Verdict: ${existingMark.verdict.toUpperCase()}`);
                console.log(`   🔍 Reviewer: ${existingMark.reviewer}`);
                console.log(`   ⏰ Timestamp: ${existingMark.timestamp}`);
                if (existingMark.audit_id) {
                    console.log(`   📋 Audit ID: ${existingMark.audit_id}`);
                }
                if (existingMark.notes) {
                    console.log(`   📝 Notes: ${existingMark.notes}`);
                }
                console.log('');
            } else {
                console.log(`⚠️  Branch "${branchName}" has no audit mark.`);
            }
            return;
        }

        // Handle unmark
        if (options.unmark) {
            if (existingMark) {
                const newDescription = injectAuditMark(branch.description, null);
                await storage.update(branchName, { description: newDescription || undefined });

                if (options.json) {
                    console.log(JSON.stringify({ action: 'unmark', branch: branchName, success: true }));
                } else {
                    console.log(`🕷️ Removed audit mark from "${branchName}"`);
                }
            } else {
                if (options.json) {
                    console.log(JSON.stringify({ action: 'unmark', branch: branchName, success: false, reason: 'no mark found' }));
                } else {
                    console.log(`⚠️  Branch "${branchName}" has no audit mark to remove.`);
                }
            }
            return;
        }

        // Determine pass/fail status
        let passed = true;
        if (options.failed) {
            passed = false;
        } else if (options.passed) {
            passed = true;
        } else if (options.verdict === 'block' || options.verdict === 'review') {
            passed = false;
        }

        // Map verdict
        let verdict: 'safe' | 'review' | 'block' = 'safe';
        if (options.verdict && ['safe', 'review', 'block'].includes(options.verdict)) {
            verdict = options.verdict as 'safe' | 'review' | 'block';
        } else if (options.failed) {
            verdict = 'block';
        }

        // Create audit mark
        const auditMark: AuditMark = {
            reviewer: options.reviewer,
            passed,
            verdict,
            timestamp: new Date().toISOString(),
        };

        if (options.auditId) {
            auditMark.audit_id = options.auditId;
        }
        if (options.notes) {
            auditMark.notes = options.notes;
        }

        // Update branch description with audit mark
        const newDescription = injectAuditMark(branch.description, auditMark);
        await storage.update(branchName, { description: newDescription });

        // Output
        if (options.json) {
            console.log(JSON.stringify({
                action: 'mark',
                branch: branchName,
                auditMark,
                success: true,
            }, null, 2));
            return;
        }

        // Human-readable output
        console.log('');
        console.log('🕷️  Spidersan Audit Mark');
        console.log('');

        const verdictEmoji = {
            safe: '✅',
            review: '⚠️',
            block: '🚫',
        };

        console.log(`   📍 Branch: ${branchName}`);
        console.log(`   ${verdictEmoji[verdict]} Verdict: ${verdict.toUpperCase()}`);
        console.log(`   🔍 Reviewer: ${options.reviewer}`);
        console.log(`   ⏰ Timestamp: ${auditMark.timestamp}`);

        if (auditMark.audit_id) {
            console.log(`   📋 Audit ID: ${auditMark.audit_id}`);
        }
        if (auditMark.notes) {
            console.log(`   📝 Notes: ${auditMark.notes}`);
        }

        console.log('');
        console.log(`   ${passed ? '✅ Branch marked as PASSED security review' : '❌ Branch marked as FAILED security review'}`);
        console.log('');
    });
