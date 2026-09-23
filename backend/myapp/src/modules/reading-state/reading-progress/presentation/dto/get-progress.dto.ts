import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class GetProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;
}
