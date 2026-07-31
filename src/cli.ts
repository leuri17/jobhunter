#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

export function createProgram(): Command {
  return new Command().name('jobhunter').description('Local job discovery pipeline');
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await createProgram().parseAsync(process.argv);
}
