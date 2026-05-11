export interface RegisterRenderOptions {
    branchName: string;
    files: string[];
    isUpdate: boolean;
    autoDetected?: boolean;
    autoDetectedFiles?: string[];
}

/** Pure. Returns terminal string for spidersan register success output. */
export function renderRegisterResult(opts: RegisterRenderOptions): string {
    const lines: string[] = [];
    const detectedFiles = opts.autoDetectedFiles ?? opts.files;

    if (opts.autoDetected && detectedFiles.length > 0) {
        lines.push(`🕷️ Auto-detected ${detectedFiles.length} changed file(s)`);
    }

    if (opts.isUpdate) {
        lines.push(`🕷️ Updated branch: ${opts.branchName}`);
    } else {
        lines.push(`🕷️ Registered branch: ${opts.branchName}`);
    }

    if (opts.files.length > 0) {
        lines.push(`   Files: ${opts.files.join(', ')}`);
    }

    return lines.join('\n').trimEnd();
}
