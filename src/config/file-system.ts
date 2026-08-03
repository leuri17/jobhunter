export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
}
