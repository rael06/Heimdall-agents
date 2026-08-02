/**
 * Every line the CLI prints goes through here. `console` is banned by the lint
 * rules, and rightly so: a command writes its result to stdout and its problems
 * to stderr, so a pipe carries the data and nothing else.
 */

export function write(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}
