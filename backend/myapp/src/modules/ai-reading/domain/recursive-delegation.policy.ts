import { createHash } from "node:crypto";
import { AiReadingDomainError, jsonClone } from "./domain-error";

export interface RecursiveDelegationPolicyJSON {
  schemaVersion: 1;
  maxDepth: 1 | 2;
  maxChildrenPerParent: 3;
  maxDelegatedPerDepth: 3;
}

export interface DelegationSubtaskDefinition {
  goal: string;
  deliverable: string;
}

export const DEFAULT_RECURSIVE_DELEGATION_POLICY: RecursiveDelegationPolicyJSON = {
  schemaVersion: 1,
  maxDepth: 2,
  maxChildrenPerParent: 3,
  maxDelegatedPerDepth: 3,
};

export const LEGACY_DELEGATION_POLICY: RecursiveDelegationPolicyJSON = {
  ...DEFAULT_RECURSIVE_DELEGATION_POLICY,
  maxDepth: 1,
};

export class RecursiveDelegationPolicy {
  readonly value: RecursiveDelegationPolicyJSON;

  constructor(value: RecursiveDelegationPolicyJSON) {
    if (value.schemaVersion !== 1 || ![1, 2].includes(value.maxDepth)
      || value.maxChildrenPerParent !== 3 || value.maxDelegatedPerDepth !== 3) {
      throw new AiReadingDomainError("DELEGATION_POLICY_INVALID", "delegation policy is invalid");
    }
    this.value = jsonClone(value, "DELEGATION_POLICY_INVALID");
  }

  assertDepth(parentDepth: number, childDepth: number): void {
    if (childDepth !== parentDepth + 1 || childDepth > this.value.maxDepth) {
      throw new AiReadingDomainError("DELEGATION_DEPTH_EXCEEDED", "delegation exceeds the frozen maximum depth");
    }
  }

  assertParentCapacity(existingChildren: number, requestedChildren: number): void {
    if (existingChildren > 0) {
      throw new AiReadingDomainError("DELEGATION_ALREADY_PERFORMED", "an agent may delegate only once");
    }
    if (requestedChildren < 1 || requestedChildren > this.value.maxChildrenPerParent) {
      throw new AiReadingDomainError("DELEGATION_PARENT_WIDTH_EXCEEDED", "a parent may create one to three children");
    }
  }

  assertLayerCapacity(existingAtDepth: number, requestedChildren: number): void {
    if (existingAtDepth + requestedChildren > this.value.maxDelegatedPerDepth) {
      throw new AiReadingDomainError("DELEGATION_LAYER_EXCEEDED", "delegation layer has reached its width limit");
    }
  }

  validateSubtasks(subtasks: DelegationSubtaskDefinition[], ancestorGoals: string[], existingGoals: string[] = []): void {
    for (const subtask of subtasks) {
      if (typeof subtask.goal !== "string" || normalizedGoal(subtask.goal).length < 12
        || typeof subtask.deliverable !== "string" || subtask.deliverable.trim().length < 8) {
        throw new AiReadingDomainError("DELEGATION_SUBTASK_INVALID", "goal and deliverable are too short");
      }
      if (ancestorGoals.some((goal) => goalsAreNearDuplicates(goal, subtask.goal))) {
        throw new AiReadingDomainError("DELEGATION_CYCLE_DETECTED", "subtask repeats an ancestor goal");
      }
      if (existingGoals.some((goal) => goalFingerprint(goal) === goalFingerprint(subtask.goal))) {
        throw new AiReadingDomainError("DELEGATION_DUPLICATE_GOAL", "subtask goal already exists in this task");
      }
    }
    for (let left = 0; left < subtasks.length; left += 1) {
      for (let right = left + 1; right < subtasks.length; right += 1) {
        if (goalsAreNearDuplicates(subtasks[left].goal, subtasks[right].goal)) {
          throw new AiReadingDomainError("DELEGATION_DUPLICATE_GOAL", "delegation batch contains duplicate goals");
        }
      }
    }
  }
}

export function goalFingerprint(goal: string): string {
  return createHash("sha256").update(normalizedGoal(goal), "utf8").digest("hex");
}

export function goalsAreNearDuplicates(left: string, right: string): boolean {
  const a = normalizedGoal(left);
  const b = normalizedGoal(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.72) return true;
  const aPairs = bigrams(a);
  const bPairs = bigrams(b);
  if (aPairs.length === 0 || bPairs.length === 0) return false;
  const counts = new Map<string, number>();
  for (const pair of aPairs) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let intersection = 0;
  for (const pair of bPairs) {
    const count = counts.get(pair) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (aPairs.length + bPairs.length) >= 0.9;
}

function normalizedGoal(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

function bigrams(value: string): string[] {
  const chars = Array.from(value);
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}
