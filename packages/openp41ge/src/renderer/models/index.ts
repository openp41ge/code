/**
 * Models barrel export — shared data types for the openp41ge platform.
 */

export * from "./file-model";
export * from "./repository-model";
export * from "./worktree-model";
export * from "./repo-service";
export * from "./text-model";
export * from "./text-edit";
export * from "./text-model-events";
export * from "./text-decoration-provider";
export * from "./text-content-model";
export { createIpcTextContentModel } from "./ipc-text-content-model";
export { ModelRegistry } from "./model-registry";
export { TestTextContentModel } from "./test-text-content-model";
