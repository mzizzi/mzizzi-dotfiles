// Adapted from tintinweb/pi-tasks src/task-store.ts (MIT). See UPSTREAM.md and LICENSE.
export const TASK_ID = /^[1-9][0-9]{0,19}$/;

function addDependency(task, field, id) {
  if (!TASK_ID.test(id))
    throw new Error(
      "Task IDs must be positive decimal strings (up to 20 digits).",
    );
  if (task[field].includes(id)) return;
  if (task[field].length >= 100)
    throw new Error(`Task #${task.id} exceeds the 100-${field} limit.`);
  task[field].push(id);
}

export class TaskStore {
  constructor(snapshot = { nextId: 1, tasks: [] }) {
    const data = structuredClone(snapshot);
    this.nextId = data.nextId;
    this.tasks = new Map(data.tasks.map((task) => [task.id, task]));
  }

  snapshot() {
    return structuredClone({
      nextId: this.nextId,
      tasks: [...this.tasks.values()],
    });
  }

  list() {
    return [...this.tasks.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }

  get(id) {
    return this.tasks.get(id);
  }

  create(subject, description, activeForm) {
    const now = Date.now();
    const task = {
      id: String(this.nextId++),
      subject,
      description,
      activeForm,
      status: "pending",
      blocks: [],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  update(id, fields) {
    const task = this.get(id);
    if (!task) throw new Error(`Task #${id} not found`);
    const warnings = [];
    if (fields.status === "deleted") {
      this.tasks.delete(id);
      for (const other of this.tasks.values()) {
        other.blocks = other.blocks.filter((value) => value !== id);
        other.blockedBy = other.blockedBy.filter((value) => value !== id);
      }
      return warnings;
    }
    for (const key of ["subject", "description", "activeForm", "status"]) {
      if (fields[key] !== undefined) task[key] = fields[key];
    }
    for (const [field, reverse, ids] of [
      ["blocks", "blockedBy", fields.addBlocks ?? []],
      ["blockedBy", "blocks", fields.addBlockedBy ?? []],
    ]) {
      for (const targetId of ids) {
        addDependency(task, field, targetId);
        const target = this.get(targetId);
        if (target && !target[reverse].includes(id)) {
          addDependency(target, reverse, id);
          target.updatedAt = Date.now();
        }
        if (targetId === id) warnings.push(`#${id} blocks itself`);
        else if (!target) warnings.push(`#${targetId} does not exist`);
        else if (target[field].includes(id)) {
          warnings.push(`cycle: #${id} and #${targetId} block each other`);
        }
      }
    }
    if (["in_progress", "completed"].includes(fields.status)) {
      const open = this.openBlockers(task);
      if (open.length)
        warnings.push(
          `Open blockers: ${open.map((value) => `#${value}`).join(", ")}`,
        );
    }
    task.updatedAt = Date.now();
    return warnings;
  }

  openBlockers(task) {
    return task.blockedBy.filter((id) => this.get(id)?.status !== "completed");
  }
}
