import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import type { DownloadPlatform } from "../../../domain/download.types";

export class CreateDownloadTaskDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsIn(["zlibrary"])
  sourcePlatform!: DownloadPlatform;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  sourceUrl!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
