import { describe, expect, it } from 'vitest';
import { claudeSessionUri, codexThreadUri, folderUri, sessionUri } from './uris';

describe('folderUri', () => {
  it('roots a Windows path and normalizes the separators', () => {
    expect(folderUri('C:\\Users\\dev\\projects\\webshop')).toBe(
      'vscode://file/C:/Users/dev/projects/webshop',
    );
  });

  it('keeps a POSIX path as is', () => {
    expect(folderUri('/home/dev/projects/webshop')).toBe('vscode://file/home/dev/projects/webshop');
  });

  it('drops a trailing separator', () => {
    expect(folderUri('/home/dev/projects/')).toBe('vscode://file/home/dev/projects');
  });

  it('escapes characters that would break the URI', () => {
    expect(folderUri('C:\\Users\\dev\\my project')).toBe('vscode://file/C:/Users/dev/my%20project');
  });
});

describe('claudeSessionUri', () => {
  it('targets the open route of the Claude Code extension', () => {
    expect(claudeSessionUri('82305555-d01f-487f-9c42-efeb636bf8bb')).toBe(
      'vscode://Anthropic.claude-code/open?session=82305555-d01f-487f-9c42-efeb636bf8bb',
    );
  });

  it('escapes an unexpected identifier rather than building a broken route', () => {
    expect(claudeSessionUri('a&b=c')).toBe('vscode://Anthropic.claude-code/open?session=a%26b%3Dc');
  });
});

describe('codexThreadUri', () => {
  it('targets the local conversation route of the Codex extension', () => {
    expect(codexThreadUri('019fa35b-eb9b-7002-a6cf-8c7a67429d26')).toBe(
      'vscode://openai.chatgpt/local/019fa35b-eb9b-7002-a6cf-8c7a67429d26',
    );
  });

  it('escapes an unexpected identifier rather than building a broken route', () => {
    expect(codexThreadUri('a/b?c')).toBe('vscode://openai.chatgpt/local/a%2Fb%3Fc');
  });
});

describe('sessionUri', () => {
  it('picks the route of the provider that owns the session', () => {
    expect(sessionUri('claude', 'abc')).toBe(claudeSessionUri('abc'));
    expect(sessionUri('codex', 'abc')).toBe(codexThreadUri('abc'));
  });

  it('has no route for a provider it does not know', () => {
    expect(sessionUri('gemini', 'abc')).toBeUndefined();
  });
});
