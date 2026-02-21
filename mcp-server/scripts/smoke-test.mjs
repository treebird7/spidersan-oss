import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/server.js'],
        cwd: process.cwd(),
        stderr: 'pipe',
    });

    const client = new Client(
        { name: 'spidersan-mcp-smoke', version: '0.0.0' },
        { capabilities: {} }
    );

    try {
        await client.connect(transport);

        const listed = await client.listTools();
        console.log(`\n[MCP] tools/list -> ${listed.tools.length} tool(s)`);
        console.log(listed.tools.map(t => `- ${t.name}`).join('\n'));

        const branch = `__mcp_smoke__`;

        console.log('\n[MCP] tools/call register_branch');
        await client.callTool({
            name: 'register_branch',
            arguments: {
                branch,
                files: ['README.md'],
                description: 'MCP smoke test registration',
                agent: 'smoke',
                repo: 'spidersan',
            },
        });

        console.log('\n[MCP] tools/call get_branch_info');
        const info = await client.callTool({
            name: 'get_branch_info',
            arguments: { branch },
        });
        const infoText = (info.content || [])
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        console.log(infoText || '[no text content]');

        console.log('\n[MCP] tools/call check_conflicts');
        const conflicts = await client.callTool({ name: 'check_conflicts', arguments: {} });
        const conflictsText = (conflicts.content || [])
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        console.log(conflictsText || '[no text content]');

        console.log('\n[MCP] tools/call mark_abandoned (cleanup)');
        await client.callTool({ name: 'mark_abandoned', arguments: { branch } });

        console.log('\n✅ MCP smoke test completed.');
    } finally {
        await transport.close();
    }
}

main().catch((error) => {
    console.error('❌ Smoke test failed:', error);
    process.exitCode = 1;
});
