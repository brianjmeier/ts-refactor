import { Node, type SourceFile } from "ts-morph";
import { die, type Flags } from "./utils.ts";

type NodePredicate = (node: Node) => boolean;

/** Find a node matching a predicate by symbol name. */
function findByName(
  sourceFile: SourceFile,
  name: string,
  matches: NodePredicate,
) {
  for (const node of sourceFile.getDescendants()) {
    if (!matches(node)) continue;
    try {
      if (Node.isNamed(node) || Node.isNameable(node)) {
        if (node.getName() === name) return node;
      } else if ("getName" in node && typeof (node as any).getName === "function") {
        if ((node as any).getName() === name) return node;
      }
    } catch {
      // Some nodes throw on getName() — skip.
    }
  }
  return undefined;
}

/** Find a node matching a predicate at a line/column position. */
function findAtPosition(
  sourceFile: SourceFile,
  line: number,
  col: number | undefined,
  matches: NodePredicate,
) {
  if (col) {
    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
      line - 1,
      col - 1,
    );
    let node: Node | undefined = sourceFile.getDescendantAtPos(pos);
    while (node) {
      if (matches(node)) return node;
      node = node.getParent();
    }
    return undefined;
  }

  for (const node of sourceFile.getDescendants()) {
    if (!matches(node)) continue;
    if (node.getStartLineNumber() === line) return node;
  }
  return undefined;
}

/**
 * Resolve a node from flags (--symbol or --line/--col) using the given predicate.
 * Used for both renameable and referenceable lookups.
 */
export function resolveNode(
  sourceFile: SourceFile,
  flags: Flags,
  matches: NodePredicate,
  label: string,
) {
  const symbol = flags.symbol as string | undefined;
  const line = flags.line ? Number(flags.line) : undefined;
  const col = flags.col ? Number(flags.col) : undefined;

  if (line) {
    const node = findAtPosition(sourceFile, line, col, matches);
    if (!node)
      die(`No ${label} symbol at line ${line}${col ? `:${col}` : ""}`);
    return node;
  }
  if (symbol) {
    const node = findByName(sourceFile, symbol, matches);
    if (!node) die(`Symbol "${symbol}" not found (or not ${label})`);
    return node;
  }
  die("Either --symbol or --line is required");
}

export const isRenameable: NodePredicate = (node) => Node.isRenameable(node);
export const isReferenceFindable: NodePredicate = (node) =>
  Node.isReferenceFindable(node);
