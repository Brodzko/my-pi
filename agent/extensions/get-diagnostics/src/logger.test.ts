import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { initLog, log, closeLog } from "./logger";
import * as config from "./config";

// Capture what gets written to the stream
let written: string[];
const mockStream = {
  write: vi.fn((data: string) => {
    written.push(data);
    return true;
  }),
  end: vi.fn(),
};

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs");
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => mockStream),
  };
});

describe("logger", () => {
  beforeEach(() => {
    closeLog(); // Reset state between tests
    written = [];
    vi.restoreAllMocks();
    mockStream.write.mockClear();
    mockStream.end.mockClear();
  });

  afterEach(() => {
    closeLog();
  });

  describe("initLog", () => {
    it("creates .brodzko/logs directory", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join("/project", ".brodzko/logs"), {
        recursive: true,
      });
    });

    it("opens stream at .brodzko/logs/get-diagnostics.log", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        path.join("/project", ".brodzko/logs/get-diagnostics.log"),
        { flags: "w" },
      );
    });

    it("does not open stream when debugLevel is off", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "off" });
      initLog("/project");
      expect(fs.createWriteStream).not.toHaveBeenCalled();
    });

    it("is idempotent — second call is a no-op", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      initLog("/other-project");
      expect(fs.createWriteStream).toHaveBeenCalledTimes(1);
    });
  });

  describe("log", () => {
    it("does nothing when level is off", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "off" });
      initLog("/project");
      log("test", "some message");
      expect(mockStream.write).not.toHaveBeenCalled();
    });

    it("writes info messages when level is info", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      log("test", "tool registered");
      expect(written).toHaveLength(1);
      expect(written[0]).toContain("[test] tool registered");
    });

    it("writes error messages when level is error", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "error" });
      initLog("/project");
      log("test", "provider error occurred");
      expect(written).toHaveLength(1);
      expect(written[0]).toContain("provider error occurred");
    });

    it("filters verbose messages when level is info", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      log("test", "resolveFiles: glob complete");
      expect(written).toHaveLength(0);
    });

    it("includes verbose messages when level is verbose", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "verbose" });
      initLog("/project");
      log("test", "resolveFiles: glob complete");
      expect(written).toHaveLength(1);
    });

    it("includes data as JSON when provided", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      log("test", "started", { count: 5 });
      expect(written[0]).toContain('{"count":5}');
    });

    it("includes timestamp in HH:MM:SS.mmm format", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      log("test", "check timestamp");
      expect(written[0]).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });

  describe("buffering", () => {
    it("buffers messages before initLog is called", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      log("test", "early message");
      expect(mockStream.write).not.toHaveBeenCalled();
    });

    it("flushes buffered messages on initLog", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      log("test", "buffered 1");
      log("test", "buffered 2");
      initLog("/project");
      expect(written).toHaveLength(2);
      expect(written[0]).toContain("buffered 1");
      expect(written[1]).toContain("buffered 2");
    });

    it("does not flush buffered messages when level is off", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "off" });
      log("test", "will be dropped");
      initLog("/project");
      expect(written).toHaveLength(0);
    });
  });

  describe("closeLog", () => {
    it("ends the stream", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      closeLog();
      expect(mockStream.end).toHaveBeenCalled();
    });

    it("allows re-initialization after close", () => {
      vi.spyOn(config, "loadConfig").mockReturnValue({ debugLevel: "info" });
      initLog("/project");
      closeLog();
      initLog("/other");
      expect(fs.createWriteStream).toHaveBeenCalledTimes(2);
    });
  });
});
