import { describe, it, expect, vi, afterEach } from "vitest";
import { log, errorFields } from "./logger";

// P9: logs must be single-line JSON (level/time/msg + fields) on the right stream.

afterEach(() => vi.restoreAllMocks());

describe("logger", () => {
  it("emits a single-line JSON object with level/time/msg + fields to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("api_error", { method: "POST", path: "/api/x", userId: "u1" });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "error", msg: "api_error", method: "POST", path: "/api/x", userId: "u1" });
    expect(typeof parsed.time).toBe("string");
  });

  it("routes info→log and warn→warn", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.info("hi");
    log.warn("careful");
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).level).toBe("info");
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string).level).toBe("warn");
  });

  it("errorFields normalizes Error and non-Error values", () => {
    const fromError = errorFields(new Error("boom"));
    expect(fromError.error).toBe("boom");
    expect(typeof fromError.stack).toBe("string");
    expect(errorFields("plain string")).toEqual({ error: "plain string" });
    expect(errorFields(42)).toEqual({ error: "42" });
  });
});
