# ts-refactor

A skill + CLI combo that gives LLM coding agents (Claude Code, Cursor, etc.) semantic TypeScript refactoring — the same rename/move/references operations that IDEs have, but accessible from the terminal.

## Why

LLM agents are great at writing code but bad at refactoring it. They default to find-and-replace, which breaks when symbols are shadowed, re-exported, or share names across scopes. IDEs solve this with the TypeScript Language Server, but most LLM agents can't drive an IDE's rename command.

ts-refactor bridges this gap:

1. **LLM uses LSP** (built into Claude Code, or via MCP) to discover symbols — find references, go to definition, check types
2. **LLM calls ts-refactor CLI** to execute the refactor — rename, move, find references, check diagnostics
3. **ts-morph** handles the AST — every rename updates all references across the project, every file move rewrites imports

The result: LLM agents get IDE-quality refactoring through a simple CLI interface.

## Install

```bash
bun install
```

## Skill Setup (Claude Code)

Copy the skill file into your Claude Code commands directory:

```bash
cp skill.md ~/.claude/commands/ts-refactor.md
```

Then use it naturally:

```
/ts-refactor rename UserProfile to AccountProfile in src/types.ts
/ts-refactor move src/old-utils.ts to src/utils/helpers.ts
/ts-refactor references fetchUser in src/api.ts
```

The skill instructs the agent to:
1. **Discover** with LSP first (findReferences, goToDefinition, hover)
2. **Dry-run** the refactor to preview affected files
3. **Apply** the change
4. **Verify** with diagnostics
5. **Commit** atomically

## CLI Reference

### Rename

Rename a symbol across the entire project. All references updated automatically.

```bash
# By name — best for exports, types, classes
ts-refactor rename --file src/auth.ts --symbol UserSession --to AuthSession

# By position — best for locals, parameters, shadowed names
ts-refactor rename --file src/auth.ts --line 42 --col 7 --to newName

# Preview first
ts-refactor rename --file src/auth.ts --symbol UserSession --to AuthSession --dry-run
```

### References

Find all references to a symbol, grouped by file.

```bash
ts-refactor references --file src/types.ts --symbol ApiResponse
ts-refactor refs --file src/utils.ts --line 10
```

### Move

Move a file and update all import/export paths across the project.

```bash
ts-refactor move --file src/old/helper.ts --to src/new/helper.ts
ts-refactor move --file src/old/helper.ts --to src/new/helper.ts --dry-run
```

### Diagnostics

Show TypeScript errors and warnings.

```bash
ts-refactor diagnostics
ts-refactor diag --file src/auth.ts
```

## Symbol Resolution

| Method | Flag | Best for |
|--------|------|----------|
| By name | `--symbol <name>` | Exported types, functions, classes |
| By position | `--line <n> [--col <n>]` | Local variables, parameters, shadowed names |

When `--line` is used without `--col`, targets the first declaration on that line.

## Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--tsconfig <path>` | `./tsconfig.json` | Path to tsconfig |
| `--dry-run` | off | Preview changes without writing |

## How It Works

Built on [ts-morph](https://github.com/dsherret/ts-morph), which wraps the TypeScript compiler API. Loads your project via `tsconfig.json`, resolves symbols through the full AST, and applies changes with complete reference tracking. No regex, no string matching.

## License

MIT
