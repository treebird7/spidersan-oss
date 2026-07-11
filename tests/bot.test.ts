import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/commands/bot.js';

const repos = { myrepo: { path: '/tmp/x', branch: 'main', autoPush: [] } };

describe('bot parseCommand', () => {
  it('parses a valid command', () => {
    expect(parseCommand('/pull myrepo main', repos)).toEqual({
      cmd: 'pull', repo: 'myrepo', args: ['main'],
    });
  });

  it('rejects unknown commands and repos', () => {
    expect(parseCommand('/rm myrepo', repos)).toBeNull();
    expect(parseCommand('/pull other', repos)).toBeNull();
    expect(parseCommand('hello', repos)).toBeNull();
  });

  it('rejects args that could be parsed as git options', () => {
    expect(parseCommand('/pull myrepo --force', repos)).toBeNull();
    expect(parseCommand('/pull myrepo -u', repos)).toBeNull();
  });

  it('rejects path traversal in args', () => {
    expect(parseCommand('/pull myrepo ../evil', repos)).toBeNull();
  });
});
