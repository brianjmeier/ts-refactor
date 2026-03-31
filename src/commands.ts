import { Node, ts } from "ts-morph";
import { resolveNode, isRenameable, isReferenceFindable } from "./resolve.ts";
import {
  die,
  loadProject,
  loadSourceFile,
  nodeName,
  relative,
  type Flags,
} from "./utils.ts";

export async function cmdRename(flags: Flags) {
  const newName = flags.to as string;
  const dryRun = !!flags["dry-run"];
  if (!newName) die("--to is required");

  const { project, sourceFile } = loadSourceFile(flags);
  const node = resolveNode(sourceFile, flags, isRenameable, "renameable");
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
    for (const f of [...affectedFiles].sort()) console.log(`  ${f}`);
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
  for (const f of [...affectedFiles].sort()) console.log(`  ${f}`);
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
    for (const line of lines) console.log(`    :${line}`);
  }
}

export async function cmdMove(flags: Flags) {
  const toPath = flags.to as string;
  const dryRun = !!flags["dry-run"];
  if (!toPath) die("--to is required");

  const { project, sourceFile } = loadSourceFile(flags);
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
    for (const f of [...referencingFiles].sort()) console.log(`  ${f}`);
    return;
  }

  sourceFile.move(toPath);
  await project.save();

  console.log(`Moved "${flags.file}" → "${toPath}"`);
  console.log("All import/export paths updated.");
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
