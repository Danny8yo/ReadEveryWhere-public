import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { BOOK_READING_GENRES } from "../../../../catalog/domain/book-reading-profile";

export class EditBookReadingProfileDto {
  @IsOptional()
  @IsIn(BOOK_READING_GENRES)
  primaryGenre?: (typeof BOOK_READING_GENRES)[number] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(BOOK_READING_GENRES, { each: true })
  secondaryGenres?: Array<(typeof BOOK_READING_GENRES)[number]>;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  classificationSummary?: string | null;
}
