import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
} from "class-validator";

export class BatchBookAnalysisDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds!: number[];

  @IsOptional()
  @IsBoolean()
  force = false;
}
