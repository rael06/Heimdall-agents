import { cp, mkdir } from 'node:fs/promises';

// The interface is plain HTML, CSS and JavaScript with no build step, and the
// toast script is PowerShell. There is nothing to compile — only to place
// beside the compiled service, which is where both are looked up.
for (const directory of ['web', 'native', 'build']) {
  await mkdir(`dist/${directory}`, { recursive: true });
  const from = directory === 'build' ? directory : `src/${directory}`;
  await cp(from, `dist/${directory}`, { recursive: true });
}
