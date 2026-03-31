import { Node, type Project, type SourceFile, ts } from "ts-morph";
import { resolveNode, isRenameable, isReferenceFindable } from "./resolve.ts";
import {
  die,
  loadProject,
  loadSourceFile,
  nodeName,
  relative,
  type Flags,
} from "./utils.ts";
import { strategyFromFlags, type RenameOp, type MoveOp } from "./strategy.ts";

// ---------------------------------------------------------------------------
// Analysis helpers — named, functional, reusable
// ---------------------------------------------------------------------------

function collectAffectedFiles(node: Node, sourceFile: SourceFile, cwd: string): string[] {
  const files = new Set<string>();
  if (Node.isReferenceFindable(node)) {
    for (const ref of node.findReferencesAsNodes()) {
      files.add(relative(ref.getSourceFile().getFilePath(), cwd));
    }
  }
  files.add(relative(sourceFile.getFilePath(), cwd));
  return [...files].sort();
}

function collectReferences(node: Node, cwd: string): { file: string; line: number }[] {
  if (!Node.isReferenceFindable(node)) return [];
  return node
    .findReferences()
    .flatMap((entry) =>
      entry.getReferences().map((ref) => ({
        file: relative(ref.getSourceFile().getFilePath(), cwd),
        line: ref.getSourceFile().getLineAndColumnAtPos(
          ref.getTextSpan().getStart(),
        ).line,
      })),
    );
}

function collectReferencingFiles(project: Project, sourceFile: SourceFile, cwd: string): string[] {
  const files = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    const importsThis = sf
      .getImportDeclarations()
      .some((imp) => imp.getModuleSpecifierSourceFile() === sourceFile);
    const exportsThis = sf
      .getExportDeclarations()
      .some((exp) => exp.getModuleSpecifierSourceFile() === sourceFile);
    if (importsThis || exportsThis) {
      files.add(relative(sf.getFilePath(), cwd));
    }
  }
  return [...files].sort();
}

function groupReferencesByFile(
  node: Node,
  cwd: string,
): { groups: Map<string, number[]>; total: number } {
  const groups = new Map<string, number[]>();
  let total = 0;
  if (!Node.isReferenceFindable(node)) return { groups, total };

  for (const entry of node.findReferences()) {
    for (const ref of entry.getReferences()) {
      const file = relative(ref.getSourceFile().getFilePath(), cwd);
      const line = ref.getSourceFile().getLineAndColumnAtPos(
        ref.getTextSpan().getStart(),
      ).line;
      if (!groups.has(file)) groups.set(file, []);
      groups.get(file)!.push(line);
      total++;
    }
  }
  return { groups, total };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdRename(flags: Flags) {
  const newName = flags.to as string;
  if (!newName) die("--to is required");

  const { project, sourceFile } = loadSourceFile(flags);
  const node = resolveNode(sourceFile, flags, isRenameable, "renameable");
  const oldName = nodeName(node);
  const cwd = process.cwd();
  const strategy = strategyFromFlags(!!flags["dry-run"]);

  const op: RenameOp = {
    type: "rename",
    oldName,
    newName,
    affectedFiles: collectAffectedFiles(node, sourceFile, cwd),
    references: collectReferences(node, cwd),
  };

  await strategy.execute(op, () => node.rename(newName), project);
}

export function cmdReferences(flags: Flags) {
  const { sourceFile } = loadSourceFile(flags);
  const node = resolveNode(
    sourceFile,
    flags,
    isReferenceFindable,
    "referenceable",
  );
  const name = nodeName(node);
  const cwd = process.cwd();
  const { groups, total } = groupReferencesByFile(node, cwd);

  console.log(`References for "${name}" (${total} total):\n`);
  for (const [f, lines] of [...groups.entries()].sort()) {
    console.log(`  ${f}`);
    for (const line of lines) console.log(`    :${line}`);
  }
}

export async function cmdMove(flags: Flags) {
  const toPath = flags.to as string;
  if (!toPath) die("--to is required");

  const { project, sourceFile } = loadSourceFile(flags);
  const cwd = process.cwd();
  const strategy = strategyFromFlags(!!flags["dry-run"]);

  const op: MoveOp = {
    type: "move",
    fromPath: relative(sourceFile.getFilePath(), cwd),
    toPath,
    referencingFiles: collectReferencingFiles(project, sourceFile, cwd),
  };

  await strategy.execute(op, () => sourceFile.move(toPath), project);
}

export function cmdDiagnostics(flags: Flags) {
  const file = flags.file as string | undefined;
  const tsconfigPath = (flags.tsconfig as string) || "./tsconfig.json";
  const project = loadProject(tsconfigPath);
  const cwd = process.cwd();

  const diagnostics = file
    ? project.getSourceFile(file)?.getPreEmitDiagnostics() ??
      die(`File not found: ${file}`)
    : project.getPreEmitDiagnostics();

  if (diagnostics.length === 0) {
    console.log("No diagnostics found.");
    return;
  }

  const formatDiagnostic = (d: (typeof diagnostics)[number]) => {
    const sf = d.getSourceFile();
    const filePath = sf ? relative(sf.getFilePath(), cwd) : "<unknown>";
    const line = d.getLineNumber() ?? "?";
    const msg = d.getMessageText();
    const msgStr =
      typeof msg === "string"
        ? msg
        : ts.flattenDiagnosticMessageText(msg.compilerObject, "\n");
    const label =
      d.getCategory() === ts.DiagnosticCategory.Error
        ? "error"
        : d.getCategory() === ts.DiagnosticCategory.Warning
          ? "warning"
          : "info";
    return `  ${filePath}:${line} [${label}] ${msgStr}`;
  };

  console.log(`Found ${diagnostics.length} diagnostic(s):\n`);
  diagnostics.forEach((d) => console.log(formatDiagnostic(d)));
}
