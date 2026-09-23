import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { DoubanRatingCandidate } from "../../../public/metadata-source.port";

export class SaveDoubanRatingDto implements DoubanRatingCandidate {
  @IsIn(["douban"])
  sourcePlatform!: "douban";

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  sourceBookId!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(2000)
  sourceUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title!: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  authors!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  publisher!: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  publishYear!: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  isbn!: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  rating!: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratingCount!: number | null;
}
