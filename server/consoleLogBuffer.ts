import util from 'util';

export interface ServerConsoleEntry {
  seq: number;
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 1500;
const buffer: ServerConsoleEntry[] = [];
let nextSeq = 0;
let installed = false;

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
      return util.inspect(arg, { depth: 3, maxArrayLength: 50, breakLength: 160 });
    })
    .join(' ');
}

function pushEntry(level: ServerConsoleEntry['level'], args: unknown[]) {
  nextSeq += 1;
  const entry: ServerConsoleEntry = {
    seq: nextSeq,
    timestamp: new Date().toISOString(),
    level,
    message: formatArgs(args).slice(0, 4000),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

export function installServerConsoleCapture() {
  if (installed) return;
  installed = true;

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    pushEntry('log', args);
    origLog(...args);
  };
  console.info = (...args: unknown[]) => {
    pushEntry('info', args);
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushEntry('warn', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushEntry('error', args);
    origError(...args);
  };
}

export function getServerConsoleSeq(): number {
  return nextSeq;
}

export function getServerConsoleLogs(limit = 1000): ServerConsoleEntry[] {
  if (limit <= 0 || buffer.length <= limit) {
    return [...buffer];
  }
  return buffer.slice(buffer.length - limit);
}
