import { IsIn, IsOptional, IsString } from "class-validator";

export class ImportBookDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  authors?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsIn(["overwrite", "skip", "rename"])
  conflictPolicy?: "overwrite" | "skip" | "rename";
}
