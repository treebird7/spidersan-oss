import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Only include our test files, not node_modules
        include: ['tests/**/*.test.ts', 'test/**/*.spec.ts', 'src/**/*.test.ts'],

        // Explicitly exclude node_modules in all subdirectories
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/mcp-server/node_modules/**'
        ],

        // Increase memory limit to prevent OOM on larger tests
        pool: 'forks',

        // Vitest 4 format - forks config at top level
        forks: {
            maxForks: 1,
            minForks: 1
        },

        // Timeout settings
        testTimeout: 10000,
        hookTimeout: 10000,

        // Coverage settings
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: ['node_modules/', 'dist/', 'mcp-server/']
        }
    }
});
