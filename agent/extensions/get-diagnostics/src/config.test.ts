import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "./config";

// Mock fs.readFileSync — config reads from disk
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => {
      throw new Error("ENOENT");
    }),
  };
});

// Get the mocked function for per-test control
import * as fs from "node:fs";
const readFileSync = vi.mocked(fs.readFileSync);

describe("loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when config file does not exist", () => {
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config file is invalid JSON", () => {
    readFileSync.mockReturnValue("not json {{{");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config file is a non-object JSON value", () => {
    readFileSync.mockReturnValue('"just a string"');
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config file is null", () => {
    readFileSync.mockReturnValue("null");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("parses valid debugLevel", () => {
    readFileSync.mockReturnValue(JSON.stringify({ debugLevel: "verbose" }));
    expect(loadConfig()).toEqual({ debugLevel: "verbose" });
  });

  it.each(["off", "error", "info", "verbose"] as const)("accepts debugLevel '%s'", (level) => {
    readFileSync.mockReturnValue(JSON.stringify({ debugLevel: level }));
    expect(loadConfig().debugLevel).toBe(level);
  });

  it("falls back to default for unknown debugLevel value", () => {
    readFileSync.mockReturnValue(JSON.stringify({ debugLevel: "trace" }));
    expect(loadConfig().debugLevel).toBe(DEFAULT_CONFIG.debugLevel);
  });

  it("falls back to default for non-string debugLevel", () => {
    readFileSync.mockReturnValue(JSON.stringify({ debugLevel: 42 }));
    expect(loadConfig().debugLevel).toBe(DEFAULT_CONFIG.debugLevel);
  });

  it("ignores unknown fields gracefully", () => {
    readFileSync.mockReturnValue(JSON.stringify({ debugLevel: "info", unknownField: true }));
    expect(loadConfig()).toEqual({ debugLevel: "info" });
  });
});
