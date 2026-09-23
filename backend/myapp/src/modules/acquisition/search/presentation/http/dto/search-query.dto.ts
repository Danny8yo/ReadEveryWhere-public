import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { EBOOK_FORMATS, type EbookFormat } from "../../../../../intelligent-library/public/ebook-format";

export class SearchQueryDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyword!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;

  @IsOptional()
  @IsIn(["zlibrary", "all"])
  sourcePlatform: "zlibrary" | "all" = "all";

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(EBOOK_FORMATS.length)
  @IsIn(EBOOK_FORMATS, { each: true })
  formats: EbookFormat[] = [];

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
