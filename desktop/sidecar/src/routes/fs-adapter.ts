import { readFile, writeFile, rename, mkdir, access, rm } from 'node:fs/promises';
import type { FileSystem } from '@jobhunter/core/config';

export const sidecarFileSystem: FileSystem = {
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
