export type Platform = 'linux' | 'darwin' | 'win32';

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly home: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}
