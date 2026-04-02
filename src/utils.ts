import { Node, Project, type Diagnostic, type SourceFile, ts } from "ts-morph";
import { readFileSync } from "fs";
import { join, dirname } from "path";

export type Flags = Record<string, string | boolean>;

export function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function parseArgs(argv: string[]) {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/**
 * Discover workspace package→source mappings from the root package.json.
 *
 * Bun workspaces use virtual module resolution instead of node_modules symlinks,
 * so ts-morph can't follow cross-package imports without explicit TypeScript `paths`.
 * This injects them automatically so refactors work across package boundaries.
 */
export function discoverWorkspacePaths(rootDir: string): Record<string, string[]> {
  let rootPkg: { workspaces?: string[] };
  try {
    rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  } catch {
    return {};
  }

  const paths: Record<string, string[]> = {};
  for (const wsPattern of rootPkg.workspaces ?? []) {
    const pkgJsonFiles = Array.from(
      new Bun.Glob(`${wsPattern}/package.json`).scanSync({ cwd: rootDir, absolute: false }),
    );
    for (const pkgJsonFile of pkgJsonFiles) {
      let pkg: { name?: string; main?: string; types?: string };
      try {
        pkg = JSON.parse(readFileSync(join(rootDir, pkgJsonFile), "utf8"));
      } catch {
        continue;
      }
      if (!pkg.name) continue;
      const pkgDir = dirname(pkgJsonFile);
      const mainFile = pkg.types ?? pkg.main ?? "index.ts";
      paths[pkg.name] = [`${pkgDir}/${mainFile}`];
    }
  }
  return paths;
}

/**
 * Load a ts-morph Project from one or more tsconfig paths.
 *
 * --tsconfig accepts:
 *   - A single path:                    packages/db/tsconfig.json
 *   - A glob pattern:                   packages/*\/tsconfig.json
 *   - Comma-separated paths or globs:   packages/db/tsconfig.json,apps/web/tsconfig.json
 *
 * When multiple tsconfigs are provided, the first is primary (sets compiler options)
 * and the rest contribute source files via addSourceFilesFromTsConfig().
 * Workspace package paths are auto-discovered and injected as compiler path mappings
 * so cross-package imports resolve correctly across the monorepo.
 */
export function loadProject(tsconfigPattern: string): Project {
  const segments = tsconfigPattern.split(",").map((s) => s.trim()).filter(Boolean);

  const tsconfigPaths: string[] = [];
  for (const seg of segments) {
    if (seg.includes("*")) {
      const matches = Array.from(
        new Bun.Glob(seg).scanSync({ cwd: process.cwd(), absolute: true }),
      ).sort();
      tsconfigPaths.push(...matches);
    } else {
      tsconfigPaths.push(seg);
    }
  }

  if (tsconfigPaths.length === 0) die(`No tsconfig files found for pattern: ${tsconfigPattern}`);

  const rootDir = process.cwd();
  const workspacePaths = discoverWorkspacePaths(rootDir);
  const [primary, ...rest] = tsconfigPaths;

  const project = new Project({
    tsConfigFilePath: primary,
    ...(Object.keys(workspacePaths).length > 0 && {
      compilerOptions: { baseUrl: rootDir, paths: workspacePaths },
    }),
  });

  for (const tsconfig of rest) {
    project.addSourceFilesFromTsConfig(tsconfig);
  }

  if (rest.length > 0) {
    const label = tsconfigPaths.map((p) => p.replace(rootDir + "/", "")).join(", ");
    console.error(
      `Loaded ${tsconfigPaths.length} tsconfig(s) with ${Object.keys(workspacePaths).length} workspace path mappings: ${label}`,
    );
  }

  return project;
}

/** Load project + source file from common flags; dies on failure. */
export function loadSourceFile(flags: Flags): {
  project: Project;
  sourceFile: SourceFile;
  tsconfigPath: string;
} {
  const file = flags.file as string;
  const tsconfigPath = (flags.tsconfig as string) || "./tsconfig.json";
  if (!file) die("--file is required");
  const project = loadProject(tsconfigPath);
  const sourceFile = project.getSourceFile(file);
  if (!sourceFile) die(`File not found in project: ${file}`);
  return { project, sourceFile, tsconfigPath };
}

/** Get display name for a node. */
export function nodeName(node: Node): string {
  if (Node.isNamed(node)) return node.getName();
  if (Node.isNameable(node)) return node.getName() ?? "<unnamed>";
  if ("getName" in node && typeof node.getName === "function") {
    try {
      return node.getName() as string;
    } catch {
      // fall through
    }
  }
  return "<unknown>";
}

export function relative(filePath: string, cwd: string): string {
  return filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
}

const CATEGORY_LABELS: Record<number, string> = {
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Message]: "info",
  [ts.DiagnosticCategory.Suggestion]: "info",
};

function diagnosticMessage(d: Diagnostic): string {
  const msg = d.getMessageText();
  return typeof msg === "string"
    ? msg
    : ts.flattenDiagnosticMessageText(msg.compilerObject, "\n");
}

export function formatDiagnostic(d: Diagnostic, cwd: string): string {
  const file = d.getSourceFile();
  const path = file ? relative(file.getFilePath(), cwd) : "<unknown>";
  const line = d.getLineNumber() ?? "?";
  const label = CATEGORY_LABELS[d.getCategory()] ?? "info";
  return `  ${path}:${line} [${label}] ${diagnosticMessage(d)}`;
}
