import { describe, expect, it, vi } from 'vitest';
import { INSTALLER_ARGUMENTS, runInstaller } from './update';

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
