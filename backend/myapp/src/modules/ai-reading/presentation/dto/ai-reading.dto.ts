import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";
import {
  BUDGET_POLICY_CONSTRAINTS,
  type BudgetPolicyInput,
  type BudgetTier,
} from "../../domain";

@ValidatorConstraint({ name: "budgetPolicyConcurrency", async: false })
class BudgetPolicyConcurrencyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== "object") return true;
    const policy = value as Partial<BudgetPolicyInput>;
    const maxConcurrentAgents = Number(policy.maxConcurrentAgents);
    const maxDelegatedAgents = Number(policy.maxDelegatedAgents);
    if (
      !Number.isSafeInteger(maxConcurrentAgents) ||
      !Number.isSafeInteger(maxDelegatedAgents)
    ) {
      return true;
    }
    return maxDelegatedAgents === 0
      ? maxConcurrentAgents === 0
      : maxConcurrentAgents >= 1 && maxConcurrentAgents <= maxDelegatedAgents;
  }

  defaultMessage(): string {
    return "budgetPolicy has invalid maxConcurrentAgents: it must be zero when maxDelegatedAgents is zero, otherwise between 1 and maxDelegatedAgents";
  }
}

export class BudgetPolicyDto implements BudgetPolicyInput {
  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxModelTurns.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxModelTurns.max)
  maxModelTurns!: number;

  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxToolCalls.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxToolCalls.max)
  maxToolCalls!: number;

  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxReadCharacters.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxReadCharacters.max)
  maxReadCharacters!: number;

  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxDurationMs.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxDurationMs.max)
  maxDurationMs!: number;

  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxDelegatedAgents.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxDelegatedAgents.max)
  maxDelegatedAgents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(BUDGET_POLICY_CONSTRAINTS.maxConcurrentAgents.min)
  @Max(BUDGET_POLICY_CONSTRAINTS.maxConcurrentAgents.max)
  maxConcurrentAgents!: number;
}

export class ListReadingEventsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSequence = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
}

export class ReaderFocusDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sectionIndex!: number;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  chapterLabel?: string;
}

export class CreateReadingConversationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  message!: string;

  @IsIn(["quick", "standard", "deep"])
  budgetTier!: BudgetTier;

  @IsOptional()
  @Validate(BudgetPolicyConcurrencyConstraint)
  @ValidateNested()
  @Type(() => BudgetPolicyDto)
  budgetPolicy?: BudgetPolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReaderFocusDto)
  readerFocus?: ReaderFocusDto;
}

export class CreateReadingConversationTurnDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  message!: string;

  @IsIn(["quick", "standard", "deep"])
  budgetTier!: BudgetTier;

  @IsOptional()
  @Validate(BudgetPolicyConcurrencyConstraint)
  @ValidateNested()
  @Type(() => BudgetPolicyDto)
  budgetPolicy?: BudgetPolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReaderFocusDto)
  readerFocus?: ReaderFocusDto;
}

export class RetryReadingConversationTurnDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  message?: string;

  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  budgetTier?: BudgetTier;

  @IsOptional()
  @Validate(BudgetPolicyConcurrencyConstraint)
  @ValidateNested()
  @Type(() => BudgetPolicyDto)
  budgetPolicy?: BudgetPolicyDto;
}

export class ListReadingConversationsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ListConversationTurnsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeTurnNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
