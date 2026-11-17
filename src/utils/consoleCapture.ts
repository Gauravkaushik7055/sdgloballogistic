export interface BrowserConsoleEntry {
  seq: number;
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

const MAX_BROWSER_ENTRIES = 1000;
const browserLogs: BrowserConsoleEntry[] = [];
let browserSeq = 0;
let installed = false;

function serializeArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function appendBrowserLog(level: BrowserConsoleEntry['level'], args: unknown[]) {
  browserSeq += 1;
  browserLogs.push({
    seq: browserSeq,
    timestamp: new Date().toISOString(),
    level,
    message: serializeArgs(args).slice(0, 4000),
  });
  if (browserLogs.length > MAX_BROWSER_ENTRIES) {
    browserLogs.splice(0, browserLogs.length - MAX_BROWSER_ENTRIES);
  }
}

export function installBrowserConsoleCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    appendBrowserLog('log', args);
    origLog(...args);
  };
  console.info = (...args: unknown[]) => {
    appendBrowserLog('info', args);
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    appendBrowserLog('warn', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    appendBrowserLog('error', args);
    origError(...args);
  };

  window.addEventListener('error', (event) => {
    appendBrowserLog('error', [
      `[window.error] ${event.message} (${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0})`,
    ]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    appendBrowserLog('error', [`[unhandledrejection]`, event.reason]);
  });
}

export function getBrowserConsoleSeq(): number {
  return browserSeq;
}

export function getBrowserConsoleLogs(limit = 600): BrowserConsoleEntry[] {
  if (limit <= 0 || browserLogs.length <= limit) {
    return [...browserLogs];
  }
  return browserLogs.slice(browserLogs.length - limit);
}
