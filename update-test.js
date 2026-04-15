import fs from 'fs';
const file = 'test/colony-integration.spec.ts';
let code = fs.readFileSync(file, 'utf-8');
code = code.replace(
`        const claimRows = [
            makeClaimRow({
                agent_key_id: 'release-agent-uuid',
                agent_label: 'codex',
                branch: 'feature/to-be-released',
                files: ['src/released.ts'],
            }),
        ];

        const releaseRows = [
            makeReleaseRow({ branch: 'feature/to-be-released', agent_key_id: 'release-agent-uuid' }),
        ];

        mockFetch(claimRows, releaseRows);`,
`        // The branch isn't in the in-progress view anymore, so the claim is just omitted
        mockFetch([], []);`
);

code = code.replace(
`        vi.resetModules();

        const { syncFromColony } = await import('../src/lib/colony-subscriber.js');`,
`        vi.resetModules();

        // Pre-populate the registry with the branch so the sweep will find it and delete it
        await storage.register({
            name: 'feature/to-be-released',
            files: ['src/released.ts'],
            agent: 'codex',
            description: 'Colony claim by codex'
        });

        const { syncFromColony } = await import('../src/lib/colony-subscriber.js');`
);
fs.writeFileSync(file, code);
