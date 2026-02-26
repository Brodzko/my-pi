import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentStore } from "./eslint-documents";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";

const mockReadFileSync = vi.mocked(readFileSync);

describe("createDocumentStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("open", () => {
    it("tracks a file with explicit content", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "const x = 1;");

      expect(store.has("/tmp/a.ts")).toBe(true);
      expect(store.getContent("/tmp/a.ts")).toBe("const x = 1;");
      expect(store.size).toBe(1);
    });

    it("reads from disk when no content provided", () => {
      mockReadFileSync.mockReturnValueOnce("disk content");
      const store = createDocumentStore();
      store.open("/tmp/a.ts");

      expect(store.has("/tmp/a.ts")).toBe(true);
      expect(store.getContent("/tmp/a.ts")).toBe("disk content");
      expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/a.ts", "utf-8");
    });

    it("does not track if disk read fails and no content provided", () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("ENOENT");
      });
      const store = createDocumentStore();
      store.open("/tmp/missing.ts");

      expect(store.has("/tmp/missing.ts")).toBe(false);
    });

    it("tracks empty string as valid content", () => {
      const store = createDocumentStore();
      store.open("/tmp/empty.ts", "");

      expect(store.has("/tmp/empty.ts")).toBe(true);
      expect(store.getContent("/tmp/empty.ts")).toBe("");
    });
  });

  describe("change", () => {
    it("updates tracked content", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "v1");
      store.change("/tmp/a.ts", "v2");

      expect(store.getContent("/tmp/a.ts")).toBe("v2");
    });

    it("re-reads from disk when no content provided", () => {
      mockReadFileSync.mockReturnValue("updated disk");
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "old");
      store.change("/tmp/a.ts");

      expect(store.getContent("/tmp/a.ts")).toBe("updated disk");
    });

    it("removes tracking if disk read fails on change without content", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "tracked");
      expect(store.has("/tmp/a.ts")).toBe(true);

      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("ENOENT");
      });
      store.change("/tmp/a.ts");

      expect(store.has("/tmp/a.ts")).toBe(false);
    });
  });

  describe("close", () => {
    it("removes a tracked file", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "content");
      store.close("/tmp/a.ts");

      expect(store.has("/tmp/a.ts")).toBe(false);
      expect(store.size).toBe(0);
    });

    it("is a no-op for untracked files", () => {
      const store = createDocumentStore();
      store.close("/tmp/unknown.ts");

      expect(store.size).toBe(0);
    });
  });

  describe("getContent", () => {
    it("returns tracked content when available", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "tracked");

      expect(store.getContent("/tmp/a.ts")).toBe("tracked");
      // Should NOT read from disk
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it("falls back to disk for untracked files", () => {
      mockReadFileSync.mockReturnValueOnce("from disk");
      const store = createDocumentStore();

      expect(store.getContent("/tmp/untracked.ts")).toBe("from disk");
      expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/untracked.ts", "utf-8");
    });

    it("returns undefined when file is untracked and disk read fails", () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("ENOENT");
      });
      const store = createDocumentStore();

      expect(store.getContent("/tmp/missing.ts")).toBeUndefined();
    });

    it("prefers tracked content over disk", () => {
      mockReadFileSync.mockReturnValue("disk version");
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "tracked version");

      expect(store.getContent("/tmp/a.ts")).toBe("tracked version");
      // getContent should not read from disk when tracked
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("removes all tracked documents", () => {
      const store = createDocumentStore();
      store.open("/tmp/a.ts", "a");
      store.open("/tmp/b.ts", "b");
      expect(store.size).toBe(2);

      store.clear();

      expect(store.size).toBe(0);
      expect(store.has("/tmp/a.ts")).toBe(false);
      expect(store.has("/tmp/b.ts")).toBe(false);
    });
  });
});
