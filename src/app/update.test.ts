import { describe, expect, it, vi } from 'vitest';
import {
  INSTALLER_ARGUMENTS,
  runInstaller,
  updateAnswer,
  updateButtons,
  worthAnnouncing,
} from './update';
import { Release } from './release';

const release = (version: string, extra: Partial<Release> = {}): Release => ({
  version,
  installer: { name: `Setup ${version}.exe`, url: 'https://github.com/x/y', size: 10 },
  manifest: { name: 'latest.yml', url: 'https://github.com/x/latest.yml', size: 1 },
  ...extra,
});

describe('updateAnswer', () => {
  it('reads the last button as install, in both offers', () => {
    // Found by length rather than by a number written twice: an off-by-one here
    // installs an update on somebody who declined, quietly and once.
    expect(updateAnswer(false, 1)).toBe('install');
    expect(updateAnswer(true, 2)).toBe('install');
  });

  it('only offers to skip where skipping is offered', () => {
    expect(updateAnswer(true, 0)).toBe('skip');
    // Button 0 of the menu's offer is "Not now", and reading it as a skip would
    // silence a check nobody agreed to silence.
    expect(updateAnswer(false, 0)).toBe('later');
  });

  it('treats anything else as not now, which is what Escape has to mean', () => {
    // Electron answers with `cancelId` when the dialog is dismissed, and -1 is
    // what it answers with on the platforms where there is no cancel.
    expect(updateAnswer(true, 1)).toBe('later');
    expect(updateAnswer(true, -1)).toBe('later');
    expect(updateAnswer(false, -1)).toBe('later');
  });

  it('installs on the last button whatever the offer is made of', () => {
    for (const skippable of [false, true]) {
      const buttons = updateButtons(skippable);
      expect(updateAnswer(skippable, buttons.length - 1)).toBe('install');
      expect(buttons[buttons.length - 1]).toBe('install');
    }
  });

  it('reads every position back as the answer that sits there', () => {
    // The list is answers rather than labels now, so the two can be checked
    // against each other instead of against a string nobody translates.
    for (const skippable of [false, true]) {
      updateButtons(skippable).forEach((answer, index) => {
        expect(updateAnswer(skippable, index), `${skippable} ${index}`).toBe(answer);
      });
    }
  });
});

describe('worthAnnouncing', () => {
  it('speaks for an update that can actually be installed', () => {
    expect(worthAnnouncing({ kind: 'update', release: release('1.2.0') }, '')).toBe(true);
  });

  it('says nothing when there is nothing to do', () => {
    // The whole difference between this and the menu. Somebody who opened the
    // application to look at their sessions did not ask whether GitHub is up.
    expect(worthAnnouncing({ kind: 'current', release: release('1.1.0') }, '')).toBe(false);
    expect(worthAnnouncing({ kind: 'none' }, '')).toBe(false);
    expect(worthAnnouncing({ kind: 'error', message: 'offline' }, '')).toBe(false);
  });

  it('says nothing about a version already turned down', () => {
    const found = { kind: 'update', release: release('1.2.0') } as const;
    expect(worthAnnouncing(found, '1.2.0')).toBe(false);
    // And speaks again for the one after it: skipping one release is not
    // switching the check off.
    expect(worthAnnouncing({ kind: 'update', release: release('1.3.0') }, '1.2.0')).toBe(true);
  });

  it('says nothing about an update it could not install anyway', () => {
    // Both have a dialog behind the menu item, where somebody asked. Raised
    // unprompted they would be an interruption with no action attached.
    expect(
      worthAnnouncing({ kind: 'update', release: release('1.2.0', { installer: undefined }) }, ''),
    ).toBe(false);
    expect(
      worthAnnouncing({ kind: 'update', release: release('1.2.0', { manifest: undefined }) }, ''),
    ).toBe(false);
  });
});

/**
 * The half of the update that runs something.
 *
 * `release.ts` is pure and has been tested since it was written; this file was
 * left as "the network and the process launch, which cannot be either". The
 * process launch can be, once what to launch is separated from launching it —
 * and it needed to be: the arguments were wrong for as long as they went
 * unexamined, and the dialog promised the opposite of what they did.
 */

describe('INSTALLER_ARGUMENTS', () => {
  it('asks for a silent install that hands the window back', () => {
    // Both, and neither on its own. From the template that builds this
    // installer, `installSection.nsh`, on the assisted branch this project
    // takes because it sets `oneClick: false`:
    //
    //   ${if} ${isForceRun}
    //   ${andIf} ${Silent}
    //     !insertmacro doStartApp
    //   ${endIf}
    //
    // `/S` alone installs and exits, which is what left the screen empty.
    expect(INSTALLER_ARGUMENTS).toContain('/S');
    expect(INSTALLER_ARGUMENTS).toContain('--force-run');
  });
});

describe('runInstaller', () => {
  it('launches the installer with those arguments', () => {
    const launch = vi.fn();
    runInstaller('C:\\Temp\\Setup 1.1.1.exe', () => undefined, launch);
    expect(launch).toHaveBeenCalledWith('C:\\Temp\\Setup 1.1.1.exe', INSTALLER_ARGUMENTS);
  });

  it('launches before it quits, never the other way round', () => {
    // An installer cannot replace files this process still holds open, so the
    // order is the whole mechanism rather than a detail.
    const order: string[] = [];
    runInstaller(
      'C:\\Temp\\Setup.exe',
      () => order.push('quit'),
      () => order.push('launch'),
    );
    expect(order).toEqual(['launch', 'quit']);
  });

  it('stays open when the launch fails, and lets the failure be reported', () => {
    // Quitting here would close the window on a user who is about to be told
    // nothing was installed. The error travels instead, and `checkForUpdates`
    // turns it into the "Update failed" dialog.
    const quit = vi.fn();
    expect(() =>
      runInstaller('C:\\Temp\\Setup.exe', quit, () => {
        throw new Error('could not start it');
      }),
    ).toThrow(/could not start it/);
    expect(quit).not.toHaveBeenCalled();
  });
});
