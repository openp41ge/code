// Global type declarations for openp41ge-sdk-uikit

interface Openp41geBridge {
  platform?: string;
  workspace: {
    dispatch(fn: string, ...args: unknown[]): void;
  };
  file: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
  };
  dialog: {
    writeWorkspaceFile(filePath: string, data: Record<string, unknown>): Promise<boolean>;
    pickFolder(): Promise<string | null>;
    ensureDir(dirPath: string): Promise<boolean>;
    readWorkspaceFile(filePath: string): Promise<{ filePath: string; data: Record<string, unknown> } | null>;
    deleteWorkspaceFile(filePath: string, deleteData?: boolean): Promise<boolean>;
  };
  workspaceData: {
    checkRepoAccess(url: string): Promise<{ ok: boolean; error?: string }>;
    checkWorktreeBranch(wsDir: string, url: string, branch: string): Promise<{
      status: "success" | "failure" | "diverged" | "needs-sync";
      error?: string;
      warning?: string;
    }>;
    repoAlreadyCloned(url: string): Promise<boolean>;
    cloneBareRepo(url: string): Promise<{ ok: boolean; error?: string }>;
    checkoutWorktree(url: string, branch: string): Promise<{ ok: boolean; error?: string }>;
    encodeRepoUrl(url: string): Promise<string>;
    getDir(): Promise<string>;
  };
}

interface Window {
  openp41ge?: Openp41geBridge;
  __openp41ge_debug?: unknown;
}

// Vite-specific: import.meta.glob
interface ImportMeta {
  glob<Eager extends boolean>(
    pattern: string,
    options?: { eager?: Eager; query?: string; import?: string },
  ): Eager extends true ? Record<string, string> : Record<string, () => Promise<string>>;
}
