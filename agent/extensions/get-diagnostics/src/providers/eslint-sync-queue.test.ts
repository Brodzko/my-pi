import { describe, it, expect } from "vitest";
import { createSyncQueue } from "./eslint-sync-queue";

describe("createSyncQueue", () => {
  describe("enqueue", () => {
    it("queues a file with content", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "const x = 1;", true);

      expect(q.size).toBe(1);
    });

    it("queues a file without content (undefined)", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", undefined, true);

      expect(q.size).toBe(1);
    });

    it("collapses multiple updates to the same file", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "v1", true);
      q.enqueue("/tmp/a.ts", "v2", false);
      q.enqueue("/tmp/a.ts", "v3", false);

      // Only one entry per file
      expect(q.size).toBe(1);

      const entries = q.drain();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        file: "/tmp/a.ts",
        content: "v3",
        command: "open",
      });
    });

    it("tracks multiple different files", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "a", true);
      q.enqueue("/tmp/b.ts", "b", true);
      q.enqueue("/tmp/c.ts", undefined, true);

      expect(q.size).toBe(3);
    });
  });

  describe("drain", () => {
    it("returns all entries as open commands", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "content-a", true);
      q.enqueue("/tmp/b.ts", undefined, true);

      const entries = q.drain();

      expect(entries).toEqual([
        { file: "/tmp/a.ts", content: "content-a", command: "open" },
        { file: "/tmp/b.ts", content: undefined, command: "open" },
      ]);
    });

    it("clears the queue after drain", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "content", true);

      q.drain();
      expect(q.size).toBe(0);

      // Second drain returns nothing
      expect(q.drain()).toEqual([]);
    });

    it("returns empty array when queue is empty", () => {
      const q = createSyncQueue();
      expect(q.drain()).toEqual([]);
    });

    it("all entries are 'open' since server hasn't seen files yet", () => {
      const q = createSyncQueue();
      // Even if isOpen=false (change), the server hasn't seen the file
      // so it should be "open" on replay.
      q.enqueue("/tmp/a.ts", "v1", true);
      q.enqueue("/tmp/a.ts", "v2", false); // change, but still "open" for server

      const entries = q.drain();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.command).toBe("open");
    });
  });

  describe("clear", () => {
    it("discards all queued entries", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "a", true);
      q.enqueue("/tmp/b.ts", "b", true);

      q.clear();

      expect(q.size).toBe(0);
      expect(q.drain()).toEqual([]);
    });
  });

  describe("lifecycle: queue → init → drain → live", () => {
    it("captures pre-init edits and replays them in order", () => {
      const q = createSyncQueue();

      // Pre-init: agent reads and edits files
      q.enqueue("/tmp/a.ts", "read-a", true);
      q.enqueue("/tmp/b.ts", "read-b", true);
      q.enqueue("/tmp/a.ts", "edit-a-v2", false); // re-edit collapses

      expect(q.size).toBe(2);

      // Server init happens... drain the queue
      const entries = q.drain();

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ file: "/tmp/a.ts", content: "edit-a-v2", command: "open" });
      expect(entries[1]).toEqual({ file: "/tmp/b.ts", content: "read-b", command: "open" });

      // Queue is empty after drain
      expect(q.size).toBe(0);
    });

    it("handles content being set to undefined on last edit", () => {
      const q = createSyncQueue();
      q.enqueue("/tmp/a.ts", "explicit content", true);
      q.enqueue("/tmp/a.ts", undefined, false); // re-read from disk

      const entries = q.drain();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.content).toBeUndefined();
    });
  });
});
