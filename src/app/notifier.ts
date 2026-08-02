import { Notification } from 'electron';
import { Notifier } from '../service/notifier';
import { ToastContent, toastXml } from '../service/toast';

/**
 * The same toast, raised by the application instead of by PowerShell.
 *
 * Two things change, and both are the reason for having an application at all.
 * It carries our own identity, so the notification shows this app's name and
 * icon and appears under it in the Windows notification settings, rather than
 * reading "Windows PowerShell". And it costs nothing to raise: no process is
 * spawned, so the third of a second per toast goes away.
 */
export class ElectronNotifier implements Notifier {
  async send(content: ToastContent): Promise<void> {
    if (!Notification.isSupported()) {
      return;
    }
    // The raw XML is used rather than Electron's own fields because action
    // buttons on Windows are only reachable this way.
    new Notification({ toastXml: toastXml(content) }).show();
  }
}
