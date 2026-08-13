import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

export interface BinaryFileSystem {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export function createDefaultBinaryFileSystem(): BinaryFileSystem {
  return {
    async readBytes(path) {
      return new Uint8Array(await readFile(path));
    },
    async writeBytes(path, bytes) {
      await writeFile(path, bytes);
    },
    async copyFile(source, destination) {
      const bytes = await new Uint8Array(await readFile(source));
      await writeFile(destination, bytes);
    },
    async pathExists(path) {
      try {
        await readFile(path);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async rename(from, to) {
      await rename(from, to);
    },
    async removeFile(path) {
      await rm(path, { force: true });
    },
  };
}
