import { Node, Project, type Diagnostic, type SourceFile, ts } from "ts-morph";

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

export function loadProject(tsconfigPath: string): Project {
  return new Project({ tsConfigFilePath: tsconfigPath });
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
