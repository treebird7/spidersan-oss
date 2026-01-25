import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

export const semanticCommand = new Command('semantic')
    .description('🕷️ Semantic conflict detection via RLS Knowledge Graph')
    .option('-c, --check <file>', 'Check a specific file for semantic conflicts')
    .option('-q, --query <text>', 'Query the knowledge graph manually')
    .action(async (options) => {
        let AgentKnowledgeBase;
        try {
            // @ts-ignore - mappersan is an optional internal dependency
            const mappersan = await import('mappersan');
            AgentKnowledgeBase = mappersan.AgentKnowledgeBase;
        } catch (err) {
            console.error(chalk.red('\n❌ The "semantic" command requires the @treebird/mappersan package.'));
            console.log(chalk.gray('   This package is currently part of the internal Treebird ecosystem.'));
            console.log(chalk.gray('   If you are an internal user, run: npm install ../mappersan\n'));
            process.exit(1);
        }

        const kb = new AgentKnowledgeBase({
            agentId: 'spidersan',
            supabaseUrl: process.env.SUPABASE_URL || '',
            supabaseKey: process.env.SUPABASE_SERVICE_KEY || '', // Needs service key for internal
            openaiKey: process.env.OPENAI_API_KEY
        });

        if (options.query) {
            console.log(chalk.gray(`Querying: "${options.query}"`));
            try {
                const result = await kb.query(options.query);
                console.log(chalk.bold('\n📝 Context Found:'));
                console.log(result.context);

                if (result.graph.length > 0) {
                    console.log(chalk.bold('\n🕸️ Graph Connections:'));
                    result.graph.forEach((node: any) => {
                        console.log(`  ${node.connected_to} --${node.relation_type}--> ${node.node_name} (${node.node_type})`);
                    });
                }
            } catch (err: any) {
                console.error(chalk.red('Query failed:'), err.message);
            }
        } else if (options.check) {
            console.log(chalk.yellow(`Checking file: ${options.check}`));
            // MVP: Just query specifically for the file name in the graph
            // In future: read file content, extract entities, check graph intersection
            const fileName = path.basename(options.check);
            const result = await kb.query(`conflicts related to ${fileName} or file:${fileName}`);

            console.log(chalk.bold('\n⚠️ Potential Semantic Overlaps:'));
            // Heuristic display
            if (result.context.length > 50) {
                console.log(result.context);
            } else {
                console.log(chalk.green('No knowledge graph entries found for this file.'));
            }
        } else {
            console.log('Please provide --query or --check');
        }
    });
