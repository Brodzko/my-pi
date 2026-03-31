import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── State file types & helpers ──────────────────────────────────────────────
// Ported from quill-vscode/mcp-server/state-file.ts

type Reply = {
  id: string;
  comment: string;
  source: 'user' | 'agent';
};

type Annotation = {
  id: string;
  startLine: number;
  endLine: number;
  intent: string;
  comment: string;
  source: 'user' | 'agent';
  status?: 'approved' | 'dismissed';
  fileLevel?: boolean;
  replies?: Reply[];
};

type ReviewOutput = {
  file: string;
  decision?: 'approve' | 'deny' | 'abort';
  annotations: Annotation[];
};

type SessionOutput = {
  decision?: 'approve' | 'deny' | 'abort';
  files: ReviewOutput[];
};

const STATE_DIR = '.quill';
const STATE_FILE = 'state.json';

const getStatePath = (workspace: string): string =>
  join(workspace, STATE_DIR, STATE_FILE);

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const createEmptySession = (): SessionOutput => ({
  decision: undefined,
  files: [],
});

const readState = (workspace: string): SessionOutput => {
  const statePath = getStatePath(workspace);
  try {
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content) as SessionOutput;
  } catch {
    return createEmptySession();
  }
};

const writeState = (workspace: string, state: SessionOutput): void => {
  const statePath = getStatePath(workspace);
  ensureDir(statePath);
  const tmpPath = statePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmpPath, statePath);
};

const mergeAnnotations = (
  existing: SessionOutput,
  file: string,
  annotations: Annotation[]
): SessionOutput => {
  const files = [...existing.files];
  const idx = files.findIndex(f => f.file === file);

  if (idx >= 0) {
    const existingAnns = files[idx].annotations;
    files[idx] = {
      ...files[idx],
      annotations: [...existingAnns, ...annotations],
    };
  } else {
    files.push({ file, annotations });
  }

  return { ...existing, files };
};

const addReplyToAnnotation = (
  existing: SessionOutput,
  file: string,
  annotationId: string,
  reply: Reply
): SessionOutput => ({
  ...existing,
  files: existing.files.map(f => {
    if (f.file !== file) return f;
    return {
      ...f,
      annotations: f.annotations.map(a => {
        if (a.id !== annotationId) return a;
        return { ...a, replies: [...(a.replies ?? []), reply] };
      }),
    };
  }),
});

const clearAnnotationsFromState = (
  existing: SessionOutput,
  file?: string
): SessionOutput => {
  if (!file) return createEmptySession();
  return {
    ...existing,
    files: existing.files.filter(f => f.file !== file),
  };
};

const updateAnnotationInState = (
  existing: SessionOutput,
  file: string,
  annotationId: string,
  changes: Partial<Pick<Annotation, 'comment' | 'intent' | 'status'>>
): SessionOutput => ({
  ...existing,
  files: existing.files.map(f => {
    if (f.file !== file) return f;
    return {
      ...f,
      annotations: f.annotations.map(a => {
        if (a.id !== annotationId) return a;
        return { ...a, ...changes };
      }),
    };
  }),
});

const setAnnotationStatusInState = (
  existing: SessionOutput,
  file: string,
  annotationId: string,
  status: 'approved' | 'dismissed' | undefined
): SessionOutput => ({
  ...existing,
  files: existing.files.map(f => {
    if (f.file !== file) return f;
    return {
      ...f,
      annotations: f.annotations.map(a => {
        if (a.id !== annotationId) return a;
        const updated = { ...a };
        if (status === undefined) {
          delete updated.status;
        } else {
          updated.status = status;
        }
        return updated;
      }),
    };
  }),
});

const setVerdictInState = (
  existing: SessionOutput,
  decision: 'approve' | 'deny' | 'abort',
  file?: string
): SessionOutput => {
  if (!file) return { ...existing, decision };
  return {
    ...existing,
    files: existing.files.map(f => {
      if (f.file !== file) return f;
      return { ...f, decision };
    }),
  };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const ok = () => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
  details: {},
});

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  details: {},
});

// ── Extension ───────────────────────────────────────────────────────────────

export default function quillVscodeExtension(pi: ExtensionAPI) {
  // ── getAnnotations ──────────────────────────────────────────────────────

  pi.registerTool({
    name: 'getAnnotations',
    label: 'Get Annotations',
    description:
      'Get Quill annotations for a specific file or all files from VS Code.',
    parameters: Type.Object({
      file: Type.Optional(
        Type.String({
          description: 'File path to filter by. Omit for all files.',
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const result = params.file
        ? { ...state, files: state.files.filter(f => f.file === params.file) }
        : state;
      return json(result);
    },
  });

  // ── addAnnotations ──────────────────────────────────────────────────────

  pi.registerTool({
    name: 'addAnnotations',
    label: 'Add Annotations',
    description:
      'Add Quill annotations to a file in VS Code. Merges with existing annotations.',
    parameters: Type.Object({
      file: Type.String({ description: 'Relative file path' }),
      annotations: Type.Array(
        Type.Object({
          id: Type.String({ description: 'Unique annotation ID' }),
          startLine: Type.Number({
            description: 'Start line (1-indexed, 0 for file-level)',
          }),
          endLine: Type.Number({
            description: 'End line (1-indexed, 0 for file-level)',
          }),
          intent: Type.String({
            description:
              'instruct, question, comment, praise, suggestion, or uncertainty',
          }),
          comment: Type.String({ description: 'Annotation text' }),
          source: StringEnum(['user', 'agent'] as const, {
            description: 'Who created this',
          }),
          status: Type.Optional(StringEnum(['approved', 'dismissed'] as const)),
          fileLevel: Type.Optional(Type.Boolean()),
        }),
        { description: 'Annotations to add' }
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const updated = mergeAnnotations(
        state,
        params.file,
        params.annotations as Annotation[]
      );
      writeState(ctx.cwd, updated);
      return ok();
    },
  });

  // ── clearAnnotations ────────────────────────────────────────────────────

  pi.registerTool({
    name: 'clearAnnotations',
    label: 'Clear Annotations',
    description:
      'Clear Quill annotations for a specific file or all files in VS Code.',
    parameters: Type.Object({
      file: Type.Optional(
        Type.String({
          description: 'File path to clear. Omit to clear all.',
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const updated = clearAnnotationsFromState(state, params.file);
      writeState(ctx.cwd, updated);
      return ok();
    },
  });

  // ── replyToAnnotation ───────────────────────────────────────────────────

  pi.registerTool({
    name: 'replyToAnnotation',
    label: 'Reply to Annotation',
    description: 'Add a reply to an existing Quill annotation in VS Code.',
    parameters: Type.Object({
      file: Type.String({ description: 'Relative file path' }),
      annotationId: Type.String({
        description: 'ID of the annotation to reply to',
      }),
      comment: Type.String({ description: 'Reply text' }),
      source: StringEnum(['user', 'agent'] as const, {
        description: 'Who is replying',
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const updated = addReplyToAnnotation(
        state,
        params.file,
        params.annotationId,
        {
          id: randomUUID(),
          comment: params.comment,
          source: params.source,
        }
      );
      writeState(ctx.cwd, updated);
      return ok();
    },
  });

  // ── updateAnnotation ────────────────────────────────────────────────────

  pi.registerTool({
    name: 'updateAnnotation',
    label: 'Update Annotation',
    description:
      'Edit an existing Quill annotation in VS Code (comment, intent, or status).',
    parameters: Type.Object({
      file: Type.String({ description: 'Relative file path' }),
      annotationId: Type.String({
        description: 'ID of the annotation to update',
      }),
      comment: Type.Optional(Type.String({ description: 'New comment text' })),
      intent: Type.Optional(Type.String({ description: 'New intent' })),
      status: Type.Optional(
        StringEnum(['approved', 'dismissed', 'clear'] as const, {
          description: 'New status, or "clear" to remove status',
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const changes: Partial<
        Pick<Annotation, 'comment' | 'intent' | 'status'>
      > = {};
      if (params.comment !== undefined) changes.comment = params.comment;
      if (params.intent !== undefined) changes.intent = params.intent;
      if (params.status !== undefined)
        changes.status = params.status === 'clear' ? undefined : params.status;

      const updated = updateAnnotationInState(
        state,
        params.file,
        params.annotationId,
        changes
      );
      writeState(ctx.cwd, updated);
      return ok();
    },
  });

  // ── setAnnotationStatus ─────────────────────────────────────────────────

  pi.registerTool({
    name: 'setAnnotationStatus',
    label: 'Set Annotation Status',
    description:
      'Set the status of a Quill annotation in VS Code (approved, dismissed, or clear).',
    parameters: Type.Object({
      file: Type.String({ description: 'Relative file path' }),
      annotationId: Type.String({
        description: 'ID of the annotation',
      }),
      status: StringEnum(['approved', 'dismissed', 'clear'] as const, {
        description: 'Status to set, or "clear" to remove',
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const updated = setAnnotationStatusInState(
        state,
        params.file,
        params.annotationId,
        params.status === 'clear' ? undefined : params.status
      );
      writeState(ctx.cwd, updated);
      return ok();
    },
  });

  // ── getVerdict ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: 'getVerdict',
    label: 'Get Verdict',
    description: 'Get the current Quill review verdict from VS Code.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      return json({ decision: state.decision ?? null });
    },
  });

  // ── setVerdict ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: 'setVerdict',
    label: 'Set Verdict',
    description:
      'Set the Quill review verdict (approve, deny, abort) at session or file level in VS Code.',
    parameters: Type.Object({
      decision: StringEnum(['approve', 'deny', 'abort'] as const, {
        description: 'The verdict',
      }),
      file: Type.Optional(
        Type.String({
          description:
            'File path for file-level verdict. Omit for session-level.',
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      const updated = setVerdictInState(state, params.decision, params.file);
      writeState(ctx.cwd, updated);
      return ok();
    },
  });
}
