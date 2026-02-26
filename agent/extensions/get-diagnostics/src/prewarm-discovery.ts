/**
 * Prewarm file discovery — finds a good source file to trigger project loading.
 *
 * Used by both TypeScript (opens file → tsserver loads tsconfig) and ESLint
 * (lints file → @typescript-eslint loads its own Program). Both need a real
 * source file inside the right tsconfig scope.
 *
 * Extracted as shared utility so the service layer finds ONE file and passes
 * it to all providers, ensuring they warm the same project.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { globSync } from "tinyglobby";
import { log } from "./logger";

/**
 * Common project entry points, checked in order via existsSync.
 * Opening any .ts/.tsx file triggers project discovery. We just need one.
 */
const COMMON_ENTRY_POINTS = [
  // Single app / root-level
  "src/index.ts",
  "src/index.tsx",
  "src/main.ts",
  "src/main.tsx",
  "src/app.ts",
  "src/app.tsx",
  "index.ts",
  "index.tsx",
  // Next.js
  "app/layout.tsx",
  "app/page.tsx",
  "pages/index.tsx",
  "pages/_app.tsx",
] as const;

/**
 * Common monorepo workspace directories. Checked in priority order —
 * apps/ first (most likely target for diagnostics), then libs/packages.
 */
const WORKSPACE_DIRS = ["apps", "packages", "libs", "modules"] as const;

const GLOB_IGNORE = [
  "**/*.d.ts",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/*.test.*",
  "**/*.spec.*",
];

/** Skip workspace packages that are clearly test infrastructure. */
const isTestPackage = (dir: string): boolean =>
  /-(e2e|test|spec|tests|testing)$/.test(path.basename(dir));

/** Skip config/tooling files that don't exercise the real project code. */
const isSourceFile = (filePath: string): boolean =>
  !/\b(knip|jest|vitest|eslint|prettier|babel|webpack|vite|rollup|tsup)\./.test(
    path.basename(filePath),
  );

/**
 * Read workspace package directories from package.json `workspaces` or
 * pnpm-workspace.yaml. Returns absolute paths of discovered package dirs.
 * Prioritizes apps/ over libs/packages/.
 */
const discoverWorkspacePackages = (cwd: string): string[] => {
  const sortAppFirst = (dirs: string[]) =>
    dirs.sort((a, b) => {
      const aIsApp = a.includes("/apps/") ? 0 : 1;
      const bIsApp = b.includes("/apps/") ? 0 : 1;
      return aIsApp - bIsApp;
    });

  // Try package.json workspaces (npm/yarn)
  try {
    const pkgPath = path.resolve(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : undefined;
      if (patterns) {
        return sortAppFirst(
          globSync(patterns, {
            cwd,
            absolute: true,
            onlyDirectories: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  } catch {
    // Invalid package.json
  }

  // Try pnpm-workspace.yaml (simple line-by-line parse — no YAML lib needed)
  try {
    const wsPath = path.resolve(cwd, "pnpm-workspace.yaml");
    if (fs.existsSync(wsPath)) {
      const content = fs.readFileSync(wsPath, "utf-8");
      const patterns: string[] = [];
      let inPackages = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "packages:") {
          inPackages = true;
          continue;
        }
        if (inPackages) {
          const match = trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/);
          if (match?.[1]) {
            patterns.push(match[1]);
          } else if (trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
            inPackages = false;
          }
        }
      }
      if (patterns.length > 0) {
        return sortAppFirst(
          globSync(patterns, {
            cwd,
            absolute: true,
            onlyDirectories: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  } catch {
    // Invalid workspace file
  }

  return [];
};

/**
 * Find a real source .ts/.tsx file in a directory. Tries common entry points
 * first (fast existsSync), then a shallow glob as fallback. Skips config files.
 */
const findSourceFile = (dir: string): string | undefined => {
  for (const entry of COMMON_ENTRY_POINTS) {
    const candidate = path.resolve(dir, entry);
    if (fs.existsSync(candidate)) return candidate;
  }
  const results = globSync(["src/**/*.{ts,tsx}", "*.{ts,tsx}"], {
    cwd: dir,
    absolute: true,
    ignore: GLOB_IGNORE,
  });
  return results.find(isSourceFile) ?? results[0];
};

/**
 * Find ONE file from the highest-priority workspace package for prewarm.
 *
 * Key principle: prewarm exactly ONE project — the most likely target.
 * Opening files from multiple packages causes tsserver to load ALL their
 * tsconfig projects serially (30+ seconds in a monorepo), which is worse
 * than a cold first call.
 *
 * Strategy (fast → slow):
 * 1. Common entry points in root (single-app project)
 * 2. tsconfig.json "references" — first non-test ref
 * 3. tsconfig.json "files" array
 * 4. Workspace packages — first app package (apps/ prioritized)
 * 5. Monorepo glob patterns
 * 6. Broader fallback glob
 */
export const findPrewarmFile = (cwd: string): string | undefined => {
  // 1. Fast path: common entry points in root
  for (const entry of COMMON_ENTRY_POINTS) {
    const candidate = path.resolve(cwd, entry);
    if (fs.existsSync(candidate)) {
      log("prewarm-discovery", "found common entry", { entry });
      return candidate;
    }
  }

  // 2. Read tsconfig.json "references" — first non-test referenced project
  try {
    const tsconfigPath = path.resolve(cwd, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
        files?: string[];
        references?: Array<{ path: string }>;
      };

      if (Array.isArray(tsconfig.references)) {
        for (const ref of tsconfig.references) {
          const refDir = path.resolve(cwd, ref.path);
          if (isTestPackage(refDir)) continue;
          const file = findSourceFile(refDir);
          if (file) {
            log("prewarm-discovery", "found via tsconfig reference", {
              ref: ref.path,
              file: path.relative(cwd, file),
            });
            return file;
          }
        }
      }

      // 3. Try "files" array
      if (Array.isArray(tsconfig.files)) {
        const tsFile = tsconfig.files.find((f) => /\.tsx?$/.test(f));
        if (tsFile) {
          log("prewarm-discovery", "found via tsconfig files", { file: tsFile });
          return path.resolve(cwd, tsFile);
        }
      }
    }
  } catch {
    // Invalid tsconfig — fall through
  }

  // 4. Workspace packages — find a source file in the first app package.
  const workspacePackages = discoverWorkspacePackages(cwd);
  if (workspacePackages.length > 0) {
    log("prewarm-discovery", "discovered workspace packages", {
      count: workspacePackages.length,
      first3: workspacePackages.slice(0, 3).map((p) => path.relative(cwd, p)),
    });

    for (const pkgDir of workspacePackages) {
      if (isTestPackage(pkgDir)) continue;
      const file = findSourceFile(pkgDir);
      if (file) {
        log("prewarm-discovery", "found via workspace package", {
          package: path.relative(cwd, pkgDir),
          file: path.relative(cwd, file),
        });
        return file;
      }
    }
  }

  // 5. Monorepo globs — check common workspace dirs
  const monorepoGlobs = WORKSPACE_DIRS.flatMap((dir) => [
    `${dir}/*/src/index.{ts,tsx}`,
    `${dir}/*/src/main.{ts,tsx}`,
    `${dir}/*/src/app.{ts,tsx}`,
    `${dir}/*/app/layout.tsx`,
    `${dir}/*/app/page.tsx`,
  ]);
  const monorepoResults = globSync(monorepoGlobs, {
    cwd,
    absolute: true,
    ignore: ["**/node_modules/**"],
  }).sort((a, b) => {
    const aIsApp = a.includes("/apps/") ? 0 : 1;
    const bIsApp = b.includes("/apps/") ? 0 : 1;
    return aIsApp - bIsApp;
  });
  if (monorepoResults[0]) {
    log("prewarm-discovery", "found via monorepo glob", {
      file: path.relative(cwd, monorepoResults[0]),
    });
    return monorepoResults[0];
  }

  // 6. Last resort — broader glob
  const results = globSync(["*.{ts,tsx}", "src/**/*.{ts,tsx}", "**/src/index.{ts,tsx}"], {
    cwd,
    absolute: true,
    ignore: GLOB_IGNORE,
  });
  const source = results.find(isSourceFile) ?? results[0];
  if (source) {
    log("prewarm-discovery", "found via fallback glob", {
      file: path.relative(cwd, source),
    });
  }
  return source;
};
