import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { COMMANDS, LOADER_BY_NAME } from '../src/bin/command-registry.js';

/**
 * Guards the lazy CLI registry (src/bin/command-registry.ts). The CLI's cold
 * path renders the top-level `--help` listing from each entry's `description`
 * WITHOUT importing the command module, so a description here that drifts from
 * the real command's `.description()` would silently corrupt help output. This
 * test loads each command for real and asserts name + description match.
 */
describe('bin command registry', () => {
    it('has unique command names and a loader for each', () => {
        const names = COMMANDS.map(c => c.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
            expect(LOADER_BY_NAME.has(name)).toBe(true);
        }
        expect(LOADER_BY_NAME.size).toBe(COMMANDS.length);
    });

    it('each entry loads a command whose real name + description match the registry', async () => {
        for (const entry of COMMANDS) {
            const program = new Command();
            await entry.load(program);
            const cmd = program.commands.find(c => c.name() === entry.name);
            expect(cmd, `loader for "${entry.name}" did not register a command of that name`).toBeDefined();
            expect(cmd!.description(), `description drift for "${entry.name}"`).toBe(entry.description);
        }
    });
});
