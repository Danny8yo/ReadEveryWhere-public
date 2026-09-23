import { Transform } from "class-transformer";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateAnnotationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsEnum(["highlight", "underline", "squiggly"])
  annotationType?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(7)
  color?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(10000)
  note?: string | null;
}

export class DeleteAnnotationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;
}
