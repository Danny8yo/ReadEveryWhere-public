#!/usr/bin/env node

import { runRecovery } from "./core-library-recovery-lib.mjs";

const [mode, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

try {
  const result = runRecovery({
    mode,
    identitySource: required(args, "identity-source"),
    librarySource: required(args, "library-source"),
    target: required(args, "target"),
    storageRoot: required(args, "storage-root"),
    email: required(args, "email"),
    manifest: required(args, "manifest"),
    expectedCounts: {
      users: 1,
      refreshTokens: 1,
      books: 28,
      sourceRefs: 24,
      profiles: 28,
      activeArtifacts: 28,
      currentPointers: 28,
    },
  });
  process.stdout.write(
    `CORE_LIBRARY_RECOVERY_${result.status.toUpperCase()} books=${result.counts.books} sourceRefs=${result.counts.sourceRefs} artifacts=${result.counts.activeArtifacts} manifest=${args.manifest}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`CORE_LIBRARY_RECOVERY_FAILED ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag ?? "end of input"}`);
    }
    const key = flag.slice(2);
    if (parsed[key] !== undefined) throw new Error(`Duplicate argument --${key}`);
    parsed[key] = value;
  }
  return parsed;
}

function required(args, key) {
  const value = args[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}
