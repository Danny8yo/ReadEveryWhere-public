import type { QaTool } from "../selection-qa-runtime.port";
import type { QaResearchDecision } from "../selection-qa-decision";
import { SelectionQaError } from "../selection-qa.types";

export interface QaDeliveryIntent { decision?: QaResearchDecision; clarification?: string }
export interface QaToolResult {
  observationStatus: "success" | "empty" | "not_executed";
  data: Record<string, unknown>;
  /** Model projection may reference evidence already supplied in full by the context builder. */
  modelObservation?: Record<string, unknown>;
  /** Stable facts excluding durations/model wording; absent for transient observations. */
  progress?: string;
  delivery?: QaDeliveryIntent;
}
export interface QaRegisteredTool {
  kind: "reading" | "delivery";
  operation: string;
  definition(): QaTool;
  fingerprint(args: Record<string, unknown>): string;
  onRecoverableError?(): void;
  details?(args: Record<string, unknown>): Record<string, unknown>;
  execute(args: Record<string, unknown>, signal: AbortSignal, deadline: number): Promise<QaToolResult>;
}
export class QaToolRegistry {
  private readonly tools = new Map<string, QaRegisteredTool>();
  constructor(registrations: QaRegisteredTool[]) {
    for (const tool of registrations) {
      const name = tool.definition().function.name;
      if (this.tools.has(name)) throw new Error(`Duplicate QA tool: ${name}`);
      this.tools.set(name, tool);
    }
  }
  definitions(): QaTool[] { return [...this.tools.values()].map(t => t.definition()); }
  registrations(): QaRegisteredTool[] { return [...this.tools.values()]; }
  require(name: string): QaRegisteredTool {
    const tool = this.tools.get(name);
    if (!tool) throw new SelectionQaError("TOOL_NOT_ALLOWED");
    return tool;
  }
}

const scopeKeys = new Set(["bookId", "userId", "artifactId", "contentRevision", "fileChecksum", "scope"]);
export function qaArguments(raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { constraint: "valid JSON object" }); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { constraint: "JSON object" });
  const assertScope = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (scopeKeys.has(key)) throw new SelectionQaError("TOOL_SCOPE_VIOLATION");
      assertScope(child);
    }
  };
  assertScope(value);
  return value as Record<string, unknown>;
}
export function qaKeys(value: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(value).length !== fields.length || Object.keys(value).some(k => !fields.includes(k)))
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { fields, constraint: "exact required fields" });
}
export function qaIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max ||
      value.some(id => typeof id !== "string" || !id || id.length > 80) || new Set(value).size !== value.length)
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "evidenceIds", constraint: `1-${max} unique evidence IDs` });
  return value;
}
