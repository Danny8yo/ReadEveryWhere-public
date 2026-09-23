import { Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";

export class UpsertProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(128)
  bookHash?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(10000)
  location!: string;

  @IsOptional()
  @IsEnum(["epubcfi", "pdf_page"])
  locationType?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fraction!: number;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  deviceId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  deviceSequence!: number;
}
