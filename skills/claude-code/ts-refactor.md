---
description: Semantic TypeScript refactoring — rename symbols, move files, find references using ts-morph
allowed-tools: Read, Bash(bun:*), Bash(git:*), Bash(cat:*), Bash(ls:*), LSP
---

# TypeScript Refactor

Semantic refactoring powered by ts-morph. All operations understand the TypeScript AST — not string matching.

**CLI location:** `TS_REFACTOR_CLI` (set this to the absolute path to `src/cli.ts` after install)

## Discovery: Use the LSP First

Before running any rename or move, **use the built-in LSP tool** to understand what you're dealing with:

1. **Find references** — `LSP findReferences` on the symbol to see the blast radius.
2. **Go to definition** — `LSP goToDefinition` to confirm which declaration you're targeting.
3. **Hover** — `LSP hover` to check the type signature.
4. **Call hierarchy** — `LSP incomingCalls` / `LSP outgoingCalls` to understand usage patterns.

This tells you the exact file and line to pass to ts-refactor. The LSP resolves through imports, re-exports, and aliases — use it as your source of truth for "what will be affected."

## Usage

Parse `$ARGUMENTS` to determine the operation. Examples:
- `/ts-refactor rename UserProfile to AccountProfile in src/types.ts`
- `/ts-refactor rename the variable at line 42 in src/service.ts to newName`
- `/ts-refactor move src/old-utils.ts to src/utils/helpers.ts`
- `/ts-refactor references UserProfile in src/types.ts`
- `/ts-refactor diagnostics`

## Symbol Resolution

Two ways to target a symbol:

- **By name** (`--symbol`): Best for exported types, interfaces, functions. Finds the first match in the file.
- **By position** (`--line` and optionally `--col`): Best for local variables, parameters, destructured bindings, or when multiple symbols share the same name. Scope-aware — only renames in that scope.

## Workflow: Rename

1. **Discover with LSP.** Use `findReferences` or `hover` to understand the symbol.

2. **Dry run.** Always preview before applying:
   ```bash
   bun TS_REFACTOR_CLI rename \
     --file <path> --to <newName> (--symbol <name> | --line <n> [--col <n>]) \
     --dry-run --tsconfig <tsconfig-path>
   ```

3. **Apply.** After the user confirms (or immediately if the scope is small — under 5 files):
   ```bash
   bun TS_REFACTOR_CLI rename \
     --file <path> --to <newName> (--symbol <name> | --line <n> [--col <n>]) \
     --tsconfig <tsconfig-path>
   ```

4. **Verify.** Run diagnostics to check for type errors:
   ```bash
   bun TS_REFACTOR_CLI diagnostics --tsconfig <tsconfig-path>
   ```

5. **Commit.** Stage and commit the rename as a single atomic commit.

## Workflow: Move File

1. **Dry run:**
   ```bash
   bun TS_REFACTOR_CLI move \
     --file <path> --to <newPath> --dry-run --tsconfig <tsconfig-path>
   ```

2. **Apply**, then **diagnostics**, then **commit**.

## Workflow: Find References

```bash
bun TS_REFACTOR_CLI references \
  --file <path> (--symbol <name> | --line <n> [--col <n>]) --tsconfig <tsconfig-path>
```

## Workflow: Diagnostics

```bash
bun TS_REFACTOR_CLI diagnostics [--file <path>] --tsconfig <tsconfig-path>
```

## Rules
- **Use LSP to discover, ts-refactor to execute.** LSP for finding what to change, CLI for making the change.
- **Always dry-run first** for rename and move operations.
- **Always run diagnostics after** applying changes.
- **One refactor per commit** — keep renames atomic for easy revert.
- If diagnostics show errors after a rename, investigate and fix before committing.
