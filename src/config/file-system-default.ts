import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

import type { FileSystem } from './file-system.js';

export function createDefaultFileSystem(): FileSystem {
  return {
    async readFile(path) {
      return readFile(path, 'utf8');
    },
    async writeFile(path, contents) {
      await writeFile(path, contents, 'utf8');
    },
    async rename(from, to) {
      await rename(from, to);
    },
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async pathExists(path) {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    async removeFile(path) {
      await rm(path, { force: true });
    },
  };
}
