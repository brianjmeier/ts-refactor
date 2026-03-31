# ts-refactor

Semantic TypeScript refactoring CLI powered by [ts-morph](https://github.com/dsherret/ts-morph). Rename symbols, move files, find references, and check diagnostics — all AST-aware across your entire project.

## Install

```bash
bun install
```

## Usage

```bash
# Rename a symbol across the project
bun cli.ts rename --file src/auth.ts --symbol UserSession --to AuthSession --dry-run
bun cli.ts rename --file src/auth.ts --line 42 --col 7 --to newName

# Find all references to a symbol
bun cli.ts references --file src/types.ts --symbol ApiResponse
bun cli.ts refs --file src/utils.ts --line 10

# Move a file and update all imports/exports
bun cli.ts move --file src/old/helper.ts --to src/new/helper.ts --dry-run

# Show TypeScript diagnostics
bun cli.ts diagnostics
bun cli.ts diag --file src/auth.ts
```

## Symbol Resolution

Two ways to target a symbol:

| Flag | Best for | Example |
|------|----------|---------|
| `--symbol <name>` | Exported types, functions, classes | `--symbol UserSession` |
| `--line <n> [--col <n>]` | Local variables, parameters, shadowed names | `--line 42 --col 7` |

When `--line` is used without `--col`, it finds the first declaration on that line.

## Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--tsconfig <path>` | `./tsconfig.json` | Path to tsconfig |
| `--dry-run` | off | Preview changes without writing |

## How It Works

Uses ts-morph to load your TypeScript project, resolve symbols through the AST, and apply changes. Renames update every reference across the project. File moves rewrite all import/export paths automatically.

## License

MIT
