import { Transform, Type } from "class-transformer";
import {
  IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min,
  Validate,
  ValidatorConstraint, ValidatorConstraintInterface,
} from "class-validator";

@ValidatorConstraint({ name: "isValidLocation", async: false })
export class IsValidLocation implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    if (/^epubcfi\(.*\)$/.test(value)) return true;
    if (/^page:\d+:\[/.test(value)) return true;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed.page === "number" && Array.isArray(parsed.quads);
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "location must be a valid EPUB CFI string or PDF coordinate JSON";
  }
}

export class CreateAnnotationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(128)
  bookHash!: string;

  @IsEnum(["highlight", "underline", "squiggly"])
  annotationType!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(7)
  color!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Validate(IsValidLocation)
  @MaxLength(10000)
  location!: string;

  @IsOptional()
  @IsEnum(["epubcfi", "pdf_page"])
  locationType?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(5000)
  textContent!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  contextBefore?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  contextAfter?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  chapterLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sectionIndex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  textPositionStart?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  textPositionEnd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortKey?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(10000)
  note?: string;
}
