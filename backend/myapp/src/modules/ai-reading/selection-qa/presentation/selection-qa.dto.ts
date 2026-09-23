import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
export class ResolveSelectionDto {
  @IsInt() @Min(1) bookId!: number;
  @IsObject() selection!: Record<string, unknown>;
}
export class CreateConversationDto extends ResolveSelectionDto {
  @IsString() @MinLength(1) @MaxLength(128) commandId!: string;
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) question!: string;
}
export class CreateTurnDto {
  @IsString() @MinLength(1) @MaxLength(128) commandId!: string;
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) question!: string;
  @IsOptional() @IsString() @MinLength(1) retryOfTurnId?: string;
}
export class HistoryQueryDto {
  @Type(() => Number) @IsInt() @Min(1) bookId!: number;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class TurnPageDto {
  @Type(() => Number) @IsInt() @Min(0) cursor = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class EventQueryDto {
  @Type(() => Number) @IsInt() @Min(0) afterSequence = 0;
}
export class AnnotationTargetDto {
  @IsIn(["append", "create"]) kind!: "append" | "create";
  @IsOptional() @IsString() annotationId?: string;
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @IsOptional() @IsIn(["highlight", "underline", "squiggly"]) annotationType?:
    "highlight" | "underline" | "squiggly";
  @IsOptional() @IsString() @MaxLength(64) color?: string;
  @IsOptional() @IsString() @MaxLength(8000) cfi?: string;
  @IsOptional() @IsString() @MaxLength(1000) chapterLabel?: string;
}
export class ApplyAnnotationDto {
  @IsString() @MinLength(1) @MaxLength(128) commandId!: string;
  @IsString() @MinLength(1) @MaxLength(50000) appendText!: string;
  @ValidateNested()
  @Type(() => AnnotationTargetDto)
  target!: AnnotationTargetDto;
}
