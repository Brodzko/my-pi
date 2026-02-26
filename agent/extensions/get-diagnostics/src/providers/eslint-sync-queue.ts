/**
 * Sync queue for the ESLint provider.
 *
 * Buffers syncDocument calls received before the ESLint server is initialized.
 * On replay, the queued state is sent to the server so it has document
 * tracking ready before the first lint request.
 *
 * Only the latest state per file is kept — intermediate edits are collapsed.
 */

export type SyncEntry = {
  file: string;
  content: string | undefined;
  command: "open" | "change";
};

export type SyncQueue = {
  /** Queue a sync call. Tracks open vs change per file. */
  enqueue: (file: string, content: string | undefined, isOpen: boolean) => void;
  /** Drain the queue and return all entries to replay. Clears the queue. */
  drain: () => SyncEntry[];
  /** Number of queued files. */
  readonly size: number;
  /** Discard all queued entries. */
  clear: () => void;
};

export const createSyncQueue = (): SyncQueue => {
  // file → { content, firstSeen }
  // We track whether the file was first seen as "open" (new) or "change" (update).
  // On drain, first-seen files emit "open", already-known files emit "change".
  // But since the server hasn't seen any files yet (pre-init), ALL files are "open".
  const pending = new Map<string, string | undefined>();

  return {
    enqueue(file, content, _isOpen) {
      // Always store latest content. On replay, everything is "open" because
      // the server hasn't seen any files yet (it wasn't initialized).
      pending.set(file, content);
    },

    drain() {
      const entries: SyncEntry[] = [];
      for (const [file, content] of pending) {
        entries.push({ file, content, command: "open" });
      }
      pending.clear();
      return entries;
    },

    get size() {
      return pending.size;
    },

    clear() {
      pending.clear();
    },
  };
};
