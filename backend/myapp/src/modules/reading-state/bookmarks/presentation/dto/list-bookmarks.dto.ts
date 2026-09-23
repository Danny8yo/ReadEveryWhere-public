import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class ListBookmarksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;
}
