import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateDoubanConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  requestIntervalMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  cookie?: string;
}
