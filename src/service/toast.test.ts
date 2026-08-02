import { describe, expect, it } from 'vitest';
import { clamp, escapeXml, soundForStatus, toastXml } from './toast';

describe('escapeXml', () => {
  it('escapes everything that would break the document', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });
});

describe('clamp', () => {
  it('collapses whitespace, because a toast is one line', () => {
    expect(clamp('a\n  b\tc', 50)).toBe('a b c');
  });

  it('cuts what is too long and says that it did', () => {
    expect(clamp('abcdefghij', 5)).toBe('abcd…');
  });

  it('leaves a short value alone', () => {
    expect(clamp('abc', 5)).toBe('abc');
  });
});

describe('toastXml', () => {
  const content = {
    heading: 'webshop — claude',
    title: 'Review pull request 1649',
    body: 'The turn is finished, but its last message asks you something.',
    launchUri: 'http://127.0.0.1:27600/?token=abc&open=claude%3A1',
    actions: [
      { label: 'Open the session', uri: 'heimdall-agents://open?id=claude%3A1' },
      { label: 'Show the list', uri: 'heimdall-agents://show' },
    ],
  };

  it('carries what is needed to decide without opening anything', () => {
    const xml = toastXml(content);
    expect(xml).toContain('webshop — claude');
    expect(xml).toContain('Review pull request 1649');
    expect(xml).toContain('asks you something');
  });

  it('escapes the launch URI, whose query always contains an ampersand', () => {
    const xml = toastXml(content);
    expect(xml).toContain('launch="http://127.0.0.1:27600/?token=abc&amp;open=claude%3A1"');
    expect(xml).not.toMatch(/launch="[^"]*&(?!amp;)/);
  });

  it('escapes a title carrying markup, which transcripts do produce', () => {
    const xml = toastXml({ ...content, title: '<command-message>pr-review</command-message>' });
    expect(xml).toContain('&lt;command-message&gt;');
    expect(xml).not.toContain('<command-message>');
  });

  it('offers an action button rather than only a click', () => {
    expect(toastXml(content)).toContain('<action content="Open the session"');
  });

  it('carries a sound when one is given, and leaves the default otherwise', () => {
    expect(toastXml({ ...content, sound: 'ms-winsoundevent:Notification.Reminder' })).toContain(
      '<audio src="ms-winsoundevent:Notification.Reminder"/>',
    );
    expect(toastXml(content)).not.toContain('<audio');
  });
});

describe('soundForStatus', () => {
  it('gives what happened its own sound, so it is audible before it is read', () => {
    const sounds = ['idle', 'failed'].map(soundForStatus);
    expect(new Set(sounds).size).toBe(2);
  });

  it('keeps the sound a finished turn always had, through the renaming', () => {
    // The status was given a truer name and nothing about the session changed,
    // so nothing should change to the ear either.
    expect(soundForStatus('idle')).toBe('ms-winsoundevent:Notification.IM');
  });

  it('falls back to the platform default for anything else', () => {
    expect(soundForStatus('unknown')).toBe('ms-winsoundevent:Notification.Default');
  });
});
