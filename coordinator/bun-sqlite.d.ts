/**
 * The part of `bun:sqlite` the state layer uses. `coordinator/tsconfig.json`
 * compiles with `types: []` and the repo carries no Bun type package, so the
 * module is declared here instead of adding a dependency.
 */
declare module 'bun:sqlite' {
    type Param = string | number | null;

    export class Statement {
        get(...params: Param[]): unknown;
        all(...params: Param[]): unknown[];
        run(...params: Param[]): { changes: number; lastInsertRowid: number | bigint };
    }

    export class Database {
        constructor(filename: string, options?: { readonly?: boolean });
        exec(sql: string): void;
        query(sql: string): Statement;
        transaction<T>(fn: () => T): () => T;
        close(): void;
    }
}
