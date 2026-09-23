import { Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateBookmarkDto {
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

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(256)
  chapterLabel?: string;
}
