/**
 * Document tracking for the ESLint server.
 *
 * Tracks open documents with their content. Used by the server to feed
 * lintText with up-to-date content instead of reading from disk.
 *
 * Content priority: tracked document content → disk fallback.
 */
import * as fs from "node:fs";

export type DocumentStore = {
  /** Track a file. Reads from disk if no content provided. */
  open: (file: string, content?: string) => void;
  /** Update a tracked file. Re-reads from disk if no content provided. */
  change: (file: string, content?: string) => void;
  /** Stop tracking a file. */
  close: (file: string) => void;
  /** Get content: tracked → disk fallback → undefined. */
  getContent: (file: string) => string | undefined;
  /** Whether a file is tracked. */
  has: (file: string) => boolean;
  /** Number of tracked documents. */
  readonly size: number;
  /** Remove all tracked documents. */
  clear: () => void;
};

export const createDocumentStore = (): DocumentStore => {
  const documents = new Map<string, string>();

  const readFromDisk = (file: string): string | undefined => {
    try {
      return fs.readFileSync(file, "utf-8");
    } catch {
      return undefined;
    }
  };

  return {
    open(file, content) {
      if (content !== undefined) {
        documents.set(file, content);
      } else {
        const diskContent = readFromDisk(file);
        if (diskContent !== undefined) {
          documents.set(file, diskContent);
        }
      }
    },

    change(file, content) {
      if (content !== undefined) {
        documents.set(file, content);
      } else {
        const diskContent = readFromDisk(file);
        if (diskContent !== undefined) {
          documents.set(file, diskContent);
        } else {
          documents.delete(file);
        }
      }
    },

    close(file) {
      documents.delete(file);
    },

    getContent(file) {
      return documents.get(file) ?? readFromDisk(file);
    },

    has(file) {
      return documents.has(file);
    },

    get size() {
      return documents.size;
    },

    clear() {
      documents.clear();
    },
  };
};
