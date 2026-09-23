import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ScrapeMetadataDto {
  @IsIn(["zlibrary", "douban", "AI"])
  provider!: "zlibrary" | "douban" | "AI";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  bookId!: number;
}
