import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class GetReadingStateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;
}

export class StreamReadingStateDto extends GetReadingStateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}
