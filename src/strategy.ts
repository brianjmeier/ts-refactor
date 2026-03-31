import type { Project } from "ts-morph";

export type RenameOp = {
  type: "rename";
  oldName: string;
  newName: string;
  affectedFiles: string[];
  references: { file: string; line: number }[];
};

export type MoveOp = {
  type: "move";
  fromPath: string;
  toPath: string;
  referencingFiles: string[];
};

export type RefactorOp = RenameOp | MoveOp;

export interface RefactorStrategy {
  execute(
    op: RefactorOp,
    mutate: () => void,
    project: Project,
  ): Promise<void>;
}

export const dryRun: RefactorStrategy = {
  async execute(op) {
    if (op.type === "rename") {
      console.log(`Dry run: rename "${op.oldName}" → "${op.newName}"`);
      console.log(`\nAffected files (${op.affectedFiles.length}):`);
      for (const f of op.affectedFiles) console.log(`  ${f}`);
      if (op.references.length > 0) {
        console.log("\nReferences:");
        for (const ref of op.references) console.log(`  ${ref.file}:${ref.line}`);
      }
    } else {
      console.log(`Dry run: move "${op.fromPath}" → "${op.toPath}"`);
      console.log(
        `\nFiles with imports to update (${op.referencingFiles.length}):`,
      );
      for (const f of op.referencingFiles) console.log(`  ${f}`);
    }
  },
};

export const apply: RefactorStrategy = {
  async execute(op, mutate, project) {
    mutate();
    await project.save();

    if (op.type === "rename") {
      console.log(`Renamed "${op.oldName}" → "${op.newName}"`);
      console.log(`\nUpdated files (${op.affectedFiles.length}):`);
      for (const f of op.affectedFiles) console.log(`  ${f}`);
    } else {
      console.log(`Moved "${op.fromPath}" → "${op.toPath}"`);
      console.log("All import/export paths updated.");
    }
  },
};

export function strategyFromFlags(dryRunFlag: boolean): RefactorStrategy {
  return dryRunFlag ? dryRun : apply;
}
