export {};

declare global {
  interface Window {
    openp41ge?: {
      terminal?: {
        spawn(paneId: string): void;
        write(paneId: string, data: string): void;
        resize(paneId: string, cols: number, rows: number): void;
        kill(paneId: string): void;
        onData(paneId: string, callback: (data: string) => void): () => void;
        onExit(paneId: string, callback: (code: number | null) => void): () => void;
      };
    };
  }
}
