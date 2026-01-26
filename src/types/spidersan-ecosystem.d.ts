declare module 'spidersan-ecosystem' {
    import type { Command } from 'commander';

    export function getCommands(): Command[] | Promise<Command[]>;

    const defaultExport: {
        getCommands?: typeof getCommands;
    };

    export default defaultExport;
}
