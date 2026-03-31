#!/usr/bin/env bun
/**
 * ts-refactor — Semantic TypeScript refactoring CLI powered by ts-morph.
 *
 * Usage:
 *   ts-refactor rename --file <path> --to <newName> (--symbol <name> | --line <n> [--col <n>]) [--dry-run] [--tsconfig <path>]
 *   ts-refactor references --file <path> (--symbol <name> | --line <n> [--col <n>]) [--tsconfig <path>]
 *   ts-refactor move --file <path> --to <newPath> [--dry-run] [--tsconfig <path>]
 *   ts-refactor diagnostics [--file <path>] [--tsconfig <path>]
 */
import { Node, Project, type SourceFile, ts } from "ts-morph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
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

function loadProject(tsconfigPath: string): Project {
  return new Project({ tsConfigFilePath: tsconfigPath });
}

/**
 * Walk the AST to find a renameable declaration by name.
 */
function findRenameableByName(sourceFile: SourceFile, symbolName: string) {
  for (const descendant of sourceFile.getDescendants()) {
    if (!Node.isRenameable(descendant)) continue;
    if (!Node.isNamed(descendant) && !Node.isNameable(descendant)) continue;
    try {
      if (descendant.getName() === symbolName) return descendant;
    } catch {
      // Some nodes throw on getName() — skip.
    }
  }
  return undefined;
}

/**
 * Find a renameable node at a specific line/column position.
 * If --col is not given, scans the line for the first identifier and uses that.
 * Walks up from the identifier to find the nearest renameable declaration.
 */
function findRenameableAtPosition(
  sourceFile: SourceFile,
  line: number,
  col: number | undefined,
) {
  if (col) {
    // Exact position given — find the deepest node there and walk up.
    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
      line - 1,
      col - 1,
    );
    let node: Node | undefined = sourceFile.getDescendantAtPos(pos);
    while (node) {
      if (Node.isRenameable(node)) return node;
      node = node.getParent();
    }
    return undefined;
  }

  // No column — find the first declaration on this line.
  for (const descendant of sourceFile.getDescendants()) {
    if (!Node.isRenameable(descendant)) continue;
    const startLine = descendant.getStartLineNumber();
    if (startLine === line) return descendant;
  }
  return undefined;
}

/**
 * Find a reference-findable node by name.
 */
function findReferenceableByName(sourceFile: SourceFile, symbolName: string) {
  for (const descendant of sourceFile.getDescendants()) {
    if (!Node.isReferenceFindable(descendant)) continue;
    if (!Node.isNamed(descendant) && !Node.isNameable(descendant)) continue;
    try {
      if (descendant.getName() === symbolName) return descendant;
    } catch {
      // skip
    }
  }
  return undefined;
}

/**
 * Find a reference-findable node at a specific line/column position.
 */
function findReferenceableAtPosition(
  sourceFile: SourceFile,
  line: number,
  col: number | undefined,
) {
  if (col) {
    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
      line - 1,
      col - 1,
    );
    let node: Node | undefined = sourceFile.getDescendantAtPos(pos);
    while (node) {
      if (Node.isReferenceFindable(node)) return node;
      node = node.getParent();
    }
    return undefined;
  }

  for (const descendant of sourceFile.getDescendants()) {
    if (!Node.isReferenceFindable(descendant)) continue;
    if (descendant.getStartLineNumber() === line) return descendant;
  }
  return undefined;
}

/**
 * Resolve a renameable symbol from flags. Supports --symbol (by name) or --line/--col (by position).
 */
function resolveRenameable(
  sourceFile: SourceFile,
  flags: Record<string, string | boolean>,
) {
  const symbol = flags.symbol as string | undefined;
  const line = flags.line ? Number(flags.line) : undefined;
  const col = flags.col ? Number(flags.col) : undefined;

  if (line) {
    const node = findRenameableAtPosition(sourceFile, line, col);
    if (!node)
      die(`No renameable symbol at line ${line}${col ? `:${col}` : ""}`);
    return node;
  }
  if (symbol) {
    const node = findRenameableByName(sourceFile, symbol);
    if (!node) die(`Symbol "${symbol}" not found (or not renameable)`);
    return node;
  }
  die("Either --symbol or --line is required");
}

/**
 * Resolve a reference-findable symbol from flags.
 */
function resolveReferenceable(
  sourceFile: SourceFile,
  flags: Record<string, string | boolean>,
) {
  const symbol = flags.symbol as string | undefined;
  const line = flags.line ? Number(flags.line) : undefined;
  const col = flags.col ? Number(flags.col) : undefined;

  if (line) {
    const node = findReferenceableAtPosition(sourceFile, line, col);
    if (!node)
      die(`No referenceable symbol at line ${line}${col ? `:${col}` : ""}`);
    return node;
  }
  if (symbol) {
    const node = findReferenceableByName(sourceFile, symbol);
    if (!node) die(`Symbol "${symbol}" not found`);
    return node;
  }
  die("Either --symbol or --line is required");
}

/** Get display name for a node (for output messages). */
function nodeName(node: Node): string {
  if (Node.isNamed(node)) return node.getName();
  if (Node.isNameable(node)) return node.getName() ?? "<unnamed>";
  // VariableDeclaration, ParameterDeclaration, etc. have getName() but don't pass isNamed/isNameable.
  if ("getName" in node && typeof node.getName === "function") {
    try {
      return node.getName() as string;
    } catch {
      // fall through
    }
  }
  return "<unknown>";
}

function relative(filePath: string, cwd: string): string {
  return filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRename(flags: Record<string, string | boolean>) {
  const file = flags.file as string;
  const newName = flags.to as string;
  const dryRun = !!flags["dry-run"];
  const tsconfigPath = (flags.tsconfig as string) || "./tsconfig.json";

  if (!file) die("--file is required");
  if (!newName) die("--to is required");

  const project = loadProject(tsconfigPath);
  const sourceFile = project.getSourceFile(file);
  if (!sourceFile) die(`File not found in project: ${file}`);

  const node = resolveRenameable(sourceFile, flags);
  const oldName = nodeName(node);

  const cwd = process.cwd();
  const affectedFiles = new Set<string>();

  if (Node.isReferenceFindable(node)) {
    for (const ref of node.findReferencesAsNodes()) {
      affectedFiles.add(relative(ref.getSourceFile().getFilePath(), cwd));
    }
  }
  affectedFiles.add(relative(sourceFile.getFilePath(), cwd));

  if (dryRun) {
    console.log(`Dry run: rename "${oldName}" → "${newName}"`);
    console.log(`\nAffected files (${affectedFiles.size}):`);
    for (const f of [...affectedFiles].sort()) {
      console.log(`  ${f}`);
    }
    if (Node.isReferenceFindable(node)) {
      console.log("\nReferences:");
      for (const entry of node.findReferences()) {
        for (const ref of entry.getReferences()) {
          const refFile = relative(ref.getSourceFile().getFilePath(), cwd);
          const pos = ref.getTextSpan().getStart();
          const lineNum = ref.getSourceFile().getLineAndColumnAtPos(pos).line;
          console.log(`  ${refFile}:${lineNum}`);
        }
      }
    }
    return;
  }

  node.rename(newName);
  await project.save();

  console.log(`Renamed "${oldName}" → "${newName}"`);
  console.log(`\nUpdated files (${affectedFiles.size}):`);
  for (const f of [...affectedFiles].sort()) {
    console.log(`  ${f}`);
  }
}

function cmdReferences(flags: Record<string, string | boolean>) {
  const file = flags.file as string;
  const tsconfigPath = (flags.tsconfig as string) || "./tsconfig.json";

  if (!file) die("--file is required");

  const project = loadProject(tsconfigPath);
  const sourceFile = project.getSourceFile(file);
  if (!sourceFile) die(`File not found in project: ${file}`);

  const node = resolveReferenceable(sourceFile, flags);
  const name = nodeName(node);

  const cwd = process.cwd();
  let total = 0;
  const fileGroups = new Map<string, number[]>();

  for (const entry of node.findReferences()) {
    for (const ref of entry.getReferences()) {
      const refFile = relative(ref.getSourceFile().getFilePath(), cwd);
      const pos = ref.getTextSpan().getStart();
      const lineNum = ref.getSourceFile().getLineAndColumnAtPos(pos).line;
      if (!fileGroups.has(refFile)) fileGroups.set(refFile, []);
      fileGroups.get(refFile)!.push(lineNum);
      total++;
    }
  }

  console.log(`References for "${name}" (${total} total):\n`);
  for (const [f, lines] of [...fileGroups.entries()].sort()) {
    console.log(`  ${f}`);
    for (const line of lines) {
      console.log(`    :${line}`);
    }
  }
}

async function cmdMove(flags: Record<string, string | boolean>) {
  const file = flags.file as string;
  const toPath = flags.to as string;
  const dryRun = !!flags["dry-run"];
  const tsconfigPath = (flags.tsconfig as string) || "./tsconfig.json";

  if (!file) die("--file is required");
  if (!toPath) die("--to is required");

  const project = loadProject(tsconfigPath);
  const sourceFile = project.getSourceFile(file);
  if (!sourceFile) die(`File not found in project: ${file}`);

  const cwd = process.cwd();

  if (dryRun) {
    const referencingFiles = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      for (const imp of sf.getImportDeclarations()) {
        if (imp.getModuleSpecifierSourceFile() === sourceFile) {
          referencingFiles.add(relative(sf.getFilePath(), cwd));
        }
      }
      for (const exp of sf.getExportDeclarations()) {
        if (exp.getModuleSpecifierSourceFile() === sourceFile) {
          referencingFiles.add(relative(sf.getFilePath(), cwd));
        }
      }
    }

    console.log(
      `Dry run: move "${relative(sourceFile.getFilePath(), cwd)}" → "${toPath}"`,
    );
    console.log(`\nFiles with imports to update (${referencingFiles.size}):`);
    for (const f of [...referencingFiles].sort()) {
      console.log(`  ${f}`);
    }
    return;
  }

  sourceFile.move(toPath);
  await project.save();

  console.log(`Moved "${file}" → "${toPath}"`);
  console.log("All import/export paths updated.");
}

function cmdDiagnostics(flags: Record<string, string | boolean>) {
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

  console.log(`Found ${diagnostics.length} diagnostic(s):\n`);
  for (const d of diagnostics) {
    const sf = d.getSourceFile();
    const filePath = sf ? relative(sf.getFilePath(), cwd) : "<unknown>";
    const line = d.getLineNumber() ?? "?";
    const msg = d.getMessageText();
    const msgStr =
      typeof msg === "string"
        ? msg
        : ts.flattenDiagnosticMessageText(msg.compilerObject, "\n");
    const category = d.getCategory();
    const label =
      category === ts.DiagnosticCategory.Error
        ? "error"
        : category === ts.DiagnosticCategory.Warning
          ? "warning"
          : "info";
    console.log(`  ${filePath}:${line} [${label}] ${msgStr}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];

switch (command) {
  case "rename":
    await cmdRename(flags);
    break;
  case "references":
  case "refs":
    cmdReferences(flags);
    break;
  case "move":
    await cmdMove(flags);
    break;
  case "diagnostics":
  case "diag":
    cmdDiagnostics(flags);
    break;
  default:
    console.log(`ts-refactor — Semantic TypeScript refactoring CLI

Commands:
  rename      Rename a symbol across the entire project
              --file <path> --to <newName> (--symbol <name> | --line <n> [--col <n>]) [--dry-run]

  references  Find all references to a symbol
              --file <path> (--symbol <name> | --line <n> [--col <n>])

  move        Move a file and update all imports/exports
              --file <path> --to <newPath> [--dry-run]

  diagnostics Show TypeScript errors/warnings
              [--file <path>]

Symbol resolution (pick one):
  --symbol <name>     Find by name (first match — best for exports/types)
  --line <n>          Find by position (best for locals/params)
  --col <n>           Column offset (default: 1, used with --line)

Global flags:
  --tsconfig <path>   Path to tsconfig.json (default: ./tsconfig.json)
  --dry-run           Preview changes without writing to disk`);
    break;
}
