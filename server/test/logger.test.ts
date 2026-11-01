import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLogger, dateStamp, DailyLogFile, isoInZone, pruneOldLogs } from "../src/lib/logger.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "llx-logs-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const files = () => fs.readdirSync(dir).sort();
const clock = (iso: string) => { let t = new Date(iso); return { now: () => t, set: (v: string) => { t = new Date(v); } }; };

describe("date stamps", () => {
  it("name the calendar day in the chosen time zone", () => {
    const d = new Date("2026-11-01T20:00:00Z"); // 01:30 the next morning in India
    expect(dateStamp(d, "Asia/Kolkata")).toBe("2026-11-02");
    expect(dateStamp(d, "UTC")).toBe("2026-11-01");
    expect(dateStamp(d, "America/Los_Angeles")).toBe("2026-11-01");
  });
  it("give log lines a readable local time with the offset", () => {
    expect(isoInZone(new Date("2026-11-01T20:00:05.123Z"), "Asia/Kolkata")).toBe("2026-11-02T01:30:05.123+05:30");
    expect(isoInZone(new Date("2026-11-01T20:00:05.123Z"), "UTC")).toBe("2026-11-01T20:00:05.123Z");
  });
});

describe("daily files", () => {
  it("start a new file at midnight in the log time zone", () => {
    const c = clock("2026-11-01T10:00:00Z"); // 15:30 IST, 1 Nov
    const f = new DailyLogFile(dir, "app", "Asia/Kolkata", c.now);
    f.write("one\n");
    c.set("2026-11-01T18:00:00Z"); // 23:30 IST, still 1 Nov
    f.write("two\n");
    c.set("2026-11-01T18:31:00Z"); // 00:01 IST, 2 Nov
    f.write("three\n");
    f.close();
    expect(files()).toEqual(["app-2026-11-01.log", "app-2026-11-02.log"]);
    expect(fs.readFileSync(path.join(dir, "app-2026-11-01.log"), "utf8")).toBe("one\ntwo\n");
    expect(fs.readFileSync(path.join(dir, "app-2026-11-02.log"), "utf8")).toBe("three\n");
  });
  it("append when the app restarts on the same day, and create the folder if it is missing", () => {
    const nested = path.join(dir, "not", "yet", "there");
    const c = clock("2026-03-05T12:00:00Z");
    const a = new DailyLogFile(nested, "app", "UTC", c.now); a.write("before\n"); a.close();
    const b = new DailyLogFile(nested, "app", "UTC", c.now); b.write("after\n"); b.close();
    expect(fs.readFileSync(path.join(nested, "app-2026-03-05.log"), "utf8")).toBe("before\nafter\n");
  });
  it("never throws if the folder can't be written", () => {
    const blocker = path.join(dir, "file-not-folder");
    fs.writeFileSync(blocker, "x");
    const f = new DailyLogFile(path.join(blocker, "sub"), "app", "UTC");
    expect(() => f.write("lost\n")).not.toThrow();
  });
});

describe("the logger", () => {
  const make = (c = clock("2026-11-01T10:00:00Z"), level = "info") =>
    buildLogger({ level, console: false, files: { dir, timeZone: "Asia/Kolkata", now: c.now } });

  it("writes everything to the dated app log and only errors to the dated error log", () => {
    const log = make();
    log.info({ port: 4000 }, "listening");
    log.warn("careful");
    log.error({ err: { message: "boom" } }, "failed");
    log.fatal("down");
    expect(files()).toEqual(["app-2026-11-01.log", "error-2026-11-01.log"]);
    expect(read("app-2026-11-01.log").map((l) => l["msg"])).toEqual(["listening", "careful", "failed", "down"]);
    expect(read("error-2026-11-01.log").map((l) => l["msg"])).toEqual(["failed", "down"]);
    expect(read("app-2026-11-01.log")[0]).toMatchObject({ service: "llx-api", port: 4000, time: "2026-11-01T15:30:00.000+05:30" });
  });
  it("rolls both files over at midnight", () => {
    const c = clock("2026-11-01T18:00:00Z");
    const log = make(c);
    log.error("late");
    c.set("2026-11-01T19:00:00Z"); // 00:30 IST on 2 Nov
    log.error("early");
    expect(files()).toEqual(["app-2026-11-01.log", "app-2026-11-02.log", "error-2026-11-01.log", "error-2026-11-02.log"]);
    expect(read("error-2026-11-02.log")[0]).toMatchObject({ msg: "early" });
  });
  it("respects the configured level", () => {
    const log = make(undefined, "warn");
    log.info("ignored");
    log.warn("kept");
    expect(read("app-2026-11-01.log").map((l) => l["msg"])).toEqual(["kept"]);
  });
  it("keeps secrets out of the files", () => {
    const log = make();
    log.error({ req: { headers: { cookie: "llx_at=SECRET", authorization: "Bearer SECRET" } }, body: { password: "hunter2hunter2", currentPassword: "old-one-123", newPassword: "new-one-123" } }, "request failed");
    const text = fs.readFileSync(path.join(dir, "app-2026-11-01.log"), "utf8");
    for (const secret of ["SECRET", "hunter2hunter2", "old-one-123", "new-one-123"]) expect(text).not.toContain(secret);
    expect(text).toContain("[redacted]");
  });
});

describe("cleanup", () => {
  const touch = (name: string) => fs.writeFileSync(path.join(dir, name), "x");
  it("deletes only app-/error- log files older than the retention period", () => {
    for (const d of ["2026-09-01", "2026-10-10", "2026-10-20", "2026-11-01"]) { touch(`app-${d}.log`); touch(`error-${d}.log`); }
    touch("notes.txt"); touch("app-latest.log"); touch(".gitkeep");
    const removed = pruneOldLogs(dir, 14, "UTC", new Date("2026-11-01T12:00:00Z")); // keep from 18 Oct on
    expect(removed).toBe(4);
    expect(files()).toEqual([".gitkeep", "app-2026-10-20.log", "app-2026-11-01.log", "app-latest.log", "error-2026-10-20.log", "error-2026-11-01.log", "notes.txt"]);
  });
  it("keeps everything when retention is 0, and tolerates a missing folder", () => {
    touch("app-2001-01-01.log");
    expect(pruneOldLogs(dir, 0, "UTC")).toBe(0);
    expect(files()).toEqual(["app-2001-01-01.log"]);
    expect(pruneOldLogs(path.join(dir, "missing"), 30, "UTC")).toBe(0);
  });
});
