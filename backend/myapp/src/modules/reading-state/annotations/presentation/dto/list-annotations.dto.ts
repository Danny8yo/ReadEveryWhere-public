import { Transform, Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from "class-validator";

export class ListAnnotationsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsOptional()
  @IsEnum(["highlight", "underline", "squiggly"])
  type?: string;

  // 显式解析布尔：query 字符串经隐式转换会把 "false"/"0" 都变成 true，导致过滤反转。
  // 不传时保持 undefined（不过滤）；仅 "true"/true 解析为 true。
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === "true"))
  @IsBoolean()
  hasNote?: boolean;
}
