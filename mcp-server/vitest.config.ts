import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        pool: 'forks',
        forks: {
            maxForks: 1,
            minForks: 1,
        },
        testTimeout: 15000,
        hookTimeout: 15000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: ['node_modules/', 'dist/'],
        },
    },
});
