import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { BOOK_READING_GENRES } from "../../../../catalog/domain/book-reading-profile";
import { EBOOK_FORMATS, type EbookFormat } from "../../../../public/ebook-format";

export class ListLibraryBooksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsIn(BOOK_READING_GENRES)
  primaryGenre?: (typeof BOOK_READING_GENRES)[number];

  @IsOptional()
  @IsIn(BOOK_READING_GENRES)
  secondaryGenre?: (typeof BOOK_READING_GENRES)[number];

  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(EBOOK_FORMATS.length)
  @IsIn(EBOOK_FORMATS, { each: true })
  formats?: EbookFormat[];
}
