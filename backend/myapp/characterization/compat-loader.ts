import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadCompatExport<T>(modulePaths: string[], exportName: string): T {
  for (const modulePath of modulePaths) {
    const absolutePath = resolve(process.cwd(), modulePath);
    if (!existsSync(`${absolutePath}.ts`) && !existsSync(absolutePath)) continue;

    const loaded = require(absolutePath) as Record<string, unknown>;
    if (loaded[exportName]) return loaded[exportName] as T;
  }

  throw new Error(`Unable to load ${exportName} from ${modulePaths.join(", ")}`);
}

export function normalizeBusinessError(error: unknown) {
  const value = error as {
    kind?: string;
    status?: number;
    code?: number;
    field?: string | null;
    existingBookId?: number;
    message?: string;
    details?: {
      field?: string | null;
      reason?: string;
      existingBookId?: number;
    };
  };

  return {
    kind: value.kind ?? null,
    status: value.status ?? null,
    code: value.code ?? null,
    field: value.field ?? value.details?.field ?? null,
    reason: value.details?.reason ?? null,
    existingBookId: value.existingBookId ?? value.details?.existingBookId ?? null,
    message: value.message ?? String(error),
  };
}
