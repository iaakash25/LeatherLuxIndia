import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { env } from "../config/env.js";

// ── Daily log files ──────────────────────────────────────────────────────────────────────────
// logs/app-2026-11-01.log    every log line (requests, warnings, errors)
// logs/error-2026-11-01.log  errors only (level error and above), for quick triage
// A new pair of files starts at midnight in LOG_TIMEZONE; files older than LOG_RETENTION_DAYS are deleted.

const formatters = new Map<string, Intl.DateTimeFormat>();
const fmt = (timeZone: string, key: string, opts: Intl.DateTimeFormatOptions) => {
  const k = `${timeZone}|${key}`;
  let f = formatters.get(k);
  if (!f) formatters.set(k, (f = new Intl.DateTimeFormat("en-CA", { timeZone, ...opts })));
  return f;
};

/** "2026-11-02": the calendar date of `date` in `timeZone`. */
export const dateStamp = (date: Date, timeZone: string) => fmt(timeZone, "day", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** "2026-11-02T01:30:05.123+05:30": a log timestamp in the same zone the file dates use, so a line and its file always agree. */
export function isoInZone(date: Date, timeZone: string): string {
  const parts = fmt(timeZone, "full", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const offset = get("timeZoneName").replace("GMT", "") || "Z";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${get("fractionalSecond")}${offset}`;
}

/**
 * Appends lines to `<dir>/<prefix>-<date>.log`, switching file when the date changes. Writes are synchronous, so
 * nothing is lost if the process dies right after logging a fatal error, and a logging failure never crashes the app.
 */
export class DailyLogFile {
  private fd: number | null = null;
  private day = "";
  private warned = false;
  constructor(private readonly dir: string, private readonly prefix: string, private readonly timeZone: string, private readonly now: () => Date = () => new Date()) {}

  write(line: string): void {
    try {
      const day = dateStamp(this.now(), this.timeZone);
      if (this.fd === null || day !== this.day) {
        this.close();
        fs.mkdirSync(this.dir, { recursive: true });
        this.fd = fs.openSync(path.join(this.dir, `${this.prefix}-${day}.log`), "a");
        this.day = day;
      }
      fs.writeSync(this.fd, line);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        process.stderr.write(`[logger] cannot write the ${this.prefix} log in ${this.dir}: ${(err as Error).message}\n`);
      }
    }
  }

  close(): void {
    if (this.fd !== null) { try { fs.closeSync(this.fd); } catch { /* already closed */ } this.fd = null; }
  }
}

const LOG_NAME = /^(?:app|error)-(\d{4}-\d{2}-\d{2})\.log$/;

/** Deletes app-/error- log files dated before `retentionDays` ago. Other files are never touched. 0 keeps everything. */
export function pruneOldLogs(dir: string, retentionDays: number, timeZone: string, now: Date = new Date()): number {
  if (retentionDays <= 0) return 0;
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const cutoff = dateStamp(new Date(now.getTime() - retentionDays * 86_400_000), timeZone);
  let removed = 0;
  for (const name of names) {
    const m = LOG_NAME.exec(name);
    if (m && m[1]! < cutoff) {
      try { fs.unlinkSync(path.join(dir, name)); removed++; } catch { /* in use or already gone */ }
    }
  }
  return removed;
}

// ── Logger ───────────────────────────────────────────────────────────────────────────────────
export type LoggerOptions = {
  level: string;
  /** Also write to the console (stdout). */
  console?: boolean;
  /** Write daily files here. */
  files?: { dir: string; timeZone: string; now?: () => Date };
};

const REDACT = {
  // Never write credentials or tokens to logs, even by accident.
  paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.currentPassword", "*.newPassword", "*.DB_PASSWORD"],
  censor: "[redacted]",
};

export function buildLogger(o: LoggerOptions) {
  const timeZone = o.files?.timeZone ?? "UTC";
  const now = o.files?.now ?? (() => new Date());
  const base = {
    base: { service: "llx-api" },
    redact: REDACT,
    timestamp: () => `,"time":"${isoInZone(now(), timeZone)}"`,
  };
  const toConsole = o.console ?? true;

  if (!o.files || o.level === "silent") return pino({ ...base, level: o.level }, toConsole ? process.stdout : { write: () => undefined });

  const app = new DailyLogFile(o.files.dir, "app", timeZone, o.files.now);
  const errors = new DailyLogFile(o.files.dir, "error", timeZone, o.files.now);
  const streams: pino.StreamEntry[] = [
    { level: o.level as pino.Level, stream: { write: (l: string) => app.write(l) } },
    { level: "error", stream: { write: (l: string) => errors.write(l) } },
  ];
  if (toConsole) streams.unshift({ level: o.level as pino.Level, stream: process.stdout });
  return pino({ ...base, level: o.level }, pino.multistream(streams));
}

const cfg = env();
export const logger = buildLogger({
  level: cfg.LOG_LEVEL,
  ...(cfg.logToFiles ? { files: { dir: cfg.logDir, timeZone: cfg.LOG_TIMEZONE } } : {}),
});

/** Hourly housekeeping hook (see index.ts). */
export const pruneLogs = () => (cfg.logToFiles ? pruneOldLogs(cfg.logDir, cfg.LOG_RETENTION_DAYS, cfg.LOG_TIMEZONE) : 0);
