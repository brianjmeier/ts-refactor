# ts-refactor

A skill + CLI combo that gives LLM coding agents semantic TypeScript refactoring — the same rename/move/references operations that IDEs have, but accessible from the terminal.

Works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenCode](https://opencode.ai), and any LLM agent that can run shell commands.

## Why

LLM agents are great at writing code but bad at refactoring it. They default to find-and-replace, which breaks when symbols are shadowed, re-exported, or share names across scopes. IDEs solve this with the TypeScript Language Server, but most LLM agents can't drive an IDE's rename command.

ts-refactor bridges this gap:

1. **LLM uses LSP** (built into Claude Code, or via MCP) to discover symbols — find references, go to definition, check types
2. **LLM calls ts-refactor CLI** to execute the refactor — rename, move, find references, check diagnostics
3. **ts-morph** handles the AST — every rename updates all references across the project, every file move rewrites imports

The result: LLM agents get IDE-quality refactoring through a simple CLI interface.

## Install

```bash
git clone https://github.com/brianjmeier/ts-refactor.git ~/dev/ts-refactor
cd ~/dev/ts-refactor
bun install
```

## Agent Setup

### Claude Code

Copy the skill into your commands directory:

```bash
cp skills/claude-code/ts-refactor.md ~/.claude/commands/ts-refactor.md
```

Then update the `TS_REFACTOR_CLI` path in the copied file to point to your install:

```
~/dev/ts-refactor/src/cli.ts
```

The skill instructs the agent to:
1. **Discover** with LSP first (findReferences, goToDefinition, hover)
2. **Dry-run** the refactor to preview affected files
3. **Apply** the change
4. **Verify** with diagnostics
5. **Commit** atomically

Usage:
```
/ts-refactor rename UserProfile to AccountProfile in src/types.ts
/ts-refactor move src/old-utils.ts to src/utils/helpers.ts
/ts-refactor references fetchUser in src/api.ts
```

### OpenCode

Copy the skill into your commands directory:

```bash
cp skills/opencode/ts-refactor.md commands/ts-refactor.md
```

Or add it as a command in your `opencode.json`:

```json
{
  "command": {
    "ts-refactor": {
      "template": "{file:skills/opencode/ts-refactor.md}",
      "description": "Semantic TypeScript refactoring"
    }
  }
}
```

Then update the `TS_REFACTOR_CLI` path in the skill file to point to your install:

```
~/dev/ts-refactor/src/cli.ts
```

Add bash permission for the CLI:

```json
{
  "permission": {
    "bash": {
      "bun ~/dev/ts-refactor/*": "allow"
    }
  }
}
```

Usage:
```
/ts-refactor rename UserProfile to AccountProfile in src/types.ts
/ts-refactor move src/old-utils.ts to src/utils/helpers.ts
```

### Other Agents

Any LLM agent that can run shell commands can use ts-refactor directly. Add the contents of a skill file to your agent's system prompt and point it at the CLI.

## CLI Reference

### Rename

Rename a symbol across the entire project. All references updated automatically.

```bash
# By name — best for exports, types, classes
bun src/cli.ts rename --file src/auth.ts --symbol UserSession --to AuthSession

# By position — best for locals, parameters, shadowed names
bun src/cli.ts rename --file src/auth.ts --line 42 --col 7 --to newName

# Preview first
bun src/cli.ts rename --file src/auth.ts --symbol UserSession --to AuthSession --dry-run
```

### References

Find all references to a symbol, grouped by file.

```bash
bun src/cli.ts references --file src/types.ts --symbol ApiResponse
bun src/cli.ts refs --file src/utils.ts --line 10
```

### Move

Move a file and update all import/export paths across the project.

```bash
bun src/cli.ts move --file src/old/helper.ts --to src/new/helper.ts
bun src/cli.ts move --file src/old/helper.ts --to src/new/helper.ts --dry-run
```

### Diagnostics

Show TypeScript errors and warnings.

```bash
bun src/cli.ts diagnostics
bun src/cli.ts diag --file src/auth.ts
```

## Symbol Resolution

| Method | Flag | Best for |
|--------|------|----------|
| By name | `--symbol <name>` | Exported types, functions, classes |
| By position | `--line <n> [--col <n>]` | Local variables, parameters, shadowed names |

When `--line` is used without `--col`, targets the first declaration on that line.

## Monorepo Support

`--tsconfig` accepts comma-separated paths or glob patterns to load source files from multiple packages at once:

```bash
# Two explicit tsconfigs
bun src/cli.ts rename --file packages/db/src/schema.ts --symbol User --to Account \
  --tsconfig packages/db/tsconfig.json,apps/api/tsconfig.json

# Glob pattern — loads all matching tsconfigs
bun src/cli.ts rename --file packages/db/src/schema.ts --symbol User --to Account \
  --tsconfig "packages/*/tsconfig.json"
```

When multiple tsconfigs are provided, the first is primary (sets compiler options) and the rest contribute source files. This ensures cross-package references are renamed correctly.

**Bun workspace path discovery:** In Bun monorepos, `@scope/pkg` imports don't use physical `node_modules` symlinks — ts-morph can't follow them without explicit `paths` mappings. ts-refactor auto-discovers workspace packages from your root `package.json` and injects the mappings so cross-package refactors resolve correctly.

## Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--tsconfig <path>` | `./tsconfig.json` | Path, glob pattern, or comma-separated list of tsconfig paths |
| `--dry-run` | off | Preview changes without writing |

## Tests

```bash
bun test
```

## How It Works

Built on [ts-morph](https://github.com/dsherret/ts-morph), which wraps the TypeScript compiler API. Loads your project via `tsconfig.json`, resolves symbols through the full AST, and applies changes with complete reference tracking. No regex, no string matching.

## Project Structure

```
src/
  cli.ts          # Entry point — parses args, dispatches commands
  commands.ts     # Command implementations (rename, references, move, diagnostics)
  resolve.ts      # Symbol resolution by name or line/column position
  strategy.ts     # Dry-run vs apply strategy pattern
  utils.ts        # Project loading, workspace path discovery, formatting helpers
skills/
  claude-code/ts-refactor.md   # Claude Code skill (slash command)
  opencode/ts-refactor.md      # OpenCode skill (slash command)
test/
  cli.test.ts     # Integration tests (all commands, multi-tsconfig, error cases)
  fixtures/       # Sample TypeScript project used as test fixtures
```

## License

MIT
