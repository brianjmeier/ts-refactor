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
import { parseArgs } from "./utils.ts";
import { cmdRename, cmdReferences, cmdMove, cmdDiagnostics } from "./commands.ts";

const HELP = `ts-refactor — Semantic TypeScript refactoring CLI

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
  --dry-run           Preview changes without writing to disk`;

const { flags, positional } = parseArgs(process.argv.slice(2));

switch (positional[0]) {
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
    console.log(HELP);
    break;
}
