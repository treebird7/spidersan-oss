/**
 * spidersan completions
 * 
 * Generate shell completions for bash, zsh, and fish.
 */

import { Command } from 'commander';

const COMMANDS = [
    'init', 'register', 'list', 'conflicts', 'merge-order', 'ready-check',
    'depends', 'stale', 'cleanup', 'abandon', 'merged', 'sync',
    'send', 'inbox', 'msg-read',
    'keygen', 'key-import', 'keys',
    'activate', 'status',
    'wake', 'close', 'collab',
    'doctor', 'completions'
];

function generateBash(): string {
    return `# Spidersan bash completions
# Add to ~/.bashrc: eval "$(spidersan completions bash)"

_spidersan_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local commands="${COMMANDS.join(' ')}"
    
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
    fi
}

complete -F _spidersan_completions spidersan
`;
}

function generateZsh(): string {
    return `# Spidersan zsh completions
# Add to ~/.zshrc: eval "$(spidersan completions zsh)"

_spidersan() {
    local -a commands
    commands=(
${COMMANDS.map(c => `        '${c}:${c} command'`).join('\n')}
    )
    
    _arguments -C \\
        '1: :->command' \\
        '*::arg:->args'
    
    case "$state" in
        command)
            _describe 'command' commands
            ;;
    esac
}

compdef _spidersan spidersan
`;
}

function generateFish(): string {
    return `# Spidersan fish completions
# Save to ~/.config/fish/completions/spidersan.fish

${COMMANDS.map(c => `complete -c spidersan -f -n "__fish_use_subcommand" -a "${c}" -d "${c} command"`).join('\n')}
`;
}

export const completionsCommand = new Command('completions')
    .description('Generate shell completions')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell: string) => {
        switch (shell.toLowerCase()) {
            case 'bash':
                console.log(generateBash());
                break;
            case 'zsh':
                console.log(generateZsh());
                break;
            case 'fish':
                console.log(generateFish());
                break;
            default:
                console.error(`❌ Unknown shell: ${shell}`);
                console.error('   Supported: bash, zsh, fish');
                process.exit(1);
        }
    });
