/**
 * Minimal argument parser. Node's own `parseArgs` would do, but it requires
 * declaring every option up front and throws on the first unknown one, which
 * gives worse messages than the few lines below.
 */

export interface ParsedArgs {
  /** First non-option token, empty when none was given. */
  command: string;
  /** Remaining non-option tokens, in order. */
  positionals: string[];
  /** Option values, in order of appearance. A bare flag records `'true'`. */
  options: Map<string, string[]>;
}

export class UsageError extends Error {}

/**
 * `--name value`, `--name=value` and bare `--name` are all accepted. An option
 * repeated several times keeps every value, which is how `--status` and
 * `--workspace` express a multi-select.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    if (!body) {
      throw new UsageError('`--` is not an option name.');
    }
    const equals = body.indexOf('=');
    let name: string;
    let value: string;
    if (equals >= 0) {
      name = body.slice(0, equals);
      value = body.slice(equals + 1);
    } else {
      name = body;
      const next = argv[index + 1];
      // A bare flag is one whose next token is another option, or nothing.
      if (next === undefined || next.startsWith('--')) {
        value = 'true';
      } else {
        value = next;
        index += 1;
      }
    }
    const known = options.get(name);
    if (known) {
      known.push(value);
    } else {
      options.set(name, [value]);
    }
  }

  return { command: positionals.shift() ?? '', positionals, options };
}

export function values(args: ParsedArgs, name: string): string[] {
  return args.options.get(name) ?? [];
}

/** Last value wins, so a later flag overrides an earlier one. */
export function value(args: ParsedArgs, name: string): string | undefined {
  const found = values(args, name);
  return found.length ? found[found.length - 1] : undefined;
}

export function flag(args: ParsedArgs, name: string, fallback = false): boolean {
  const raw = value(args, name);
  if (raw === undefined) {
    return fallback;
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true';
  }
  throw new UsageError(`--${name} takes no value, got "${raw}".`);
}

export function number(args: ParsedArgs, name: string, fallback: number): number {
  const raw = value(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`--${name} expects a positive number, got "${raw}".`);
  }
  return parsed;
}

/**
 * Options the command does not know about. Reported rather than ignored: a
 * silently dropped filter is a wrong answer that looks right.
 */
export function unknownOptions(args: ParsedArgs, known: readonly string[]): string[] {
  return [...args.options.keys()].filter((name) => !known.includes(name));
}

/** Restricts a value to a known set, so a typo fails instead of filtering nothing. */
export function oneOf<T extends string>(
  args: ParsedArgs,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = value(args, name);
  if (raw === undefined) {
    return fallback;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new UsageError(`--${name} expects one of ${allowed.join(', ')}, got "${raw}".`);
  }
  return raw as T;
}

/** Same, for a repeatable option. */
export function manyOf<T extends string>(
  args: ParsedArgs,
  name: string,
  allowed: readonly T[],
): T[] {
  return values(args, name).flatMap((raw) =>
    // One flag may carry several values, so `--status running,failed` works too.
    raw.split(',').map((entry) => {
      const trimmed = entry.trim();
      if (!(allowed as readonly string[]).includes(trimmed)) {
        throw new UsageError(`--${name} expects one of ${allowed.join(', ')}, got "${trimmed}".`);
      }
      return trimmed as T;
    }),
  );
}
