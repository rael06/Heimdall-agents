import { request } from 'node:http';
import { ServiceFile } from './token';

/**
 * Asks a recorded service whether it is still there. A port already in use has
 * to mean "it is already running, open the browser on it" rather than a crash,
 * and the only way to tell our own service from someone else's is to talk to it
 * with the token it wrote down.
 */
export function probeService(file: ServiceFile, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const call = request(
      {
        host: file.host,
        port: file.port,
        path: '/api/state',
        method: 'GET',
        headers: {
          Host: `${file.host}:${file.port}`,
          Authorization: `Bearer ${file.token}`,
        },
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    call.on('timeout', () => {
      call.destroy();
      resolve(false);
    });
    // Nothing listening, or something that is not us: either way, not a service
    // we can hand the user over to.
    call.on('error', () => resolve(false));
    call.end();
  });
}
