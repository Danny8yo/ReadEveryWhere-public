import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class LibrarySearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class BookTocDto {
  @IsEnum(["outline", "tree", "navigation"])
  mode!: "outline" | "tree" | "navigation";

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(256, { each: true })
  nodeIds?: string[];
}

class ContentRevisionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  fileChecksum!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  extractorVersion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  normalizationVersion!: string;
}

class EpubTextPositionDto {
  @IsEnum(["epub_text"])
  kind!: "epub_text";

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sectionIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  start!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  end!: number;
}

class TextQuoteDto {
  @IsString()
  @MaxLength(256)
  exact!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  suffix?: string;
}

class StructureHintDto {
  @IsOptional() @IsString() @MaxLength(128) tocNodeId?: string;
  @IsOptional() @IsString() @MaxLength(1024) href?: string;
  @IsOptional() @IsString() @MaxLength(512) fragment?: string;
  @IsOptional() @IsString() @MaxLength(500) label?: string;
  @IsOptional() @IsString() @MaxLength(2000) path?: string;
}

class ReaderAnchorDto {
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  epubcfi?: string;
}

export class EpubBookLocatorDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  version!: 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId!: number;

  @ValidateNested()
  @Type(() => ContentRevisionDto)
  contentRevision!: ContentRevisionDto;

  @ValidateNested()
  @Type(() => EpubTextPositionDto)
  position!: EpubTextPositionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TextQuoteDto)
  textQuote?: TextQuoteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StructureHintDto)
  structure?: StructureHintDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReaderAnchorDto)
  readerAnchor?: ReaderAnchorDto;
}

export class BookReadDto {
  @ValidateNested()
  @Type(() => EpubBookLocatorDto)
  locator!: EpubBookLocatorDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpubBookLocatorDto)
  endLocator?: EpubBookLocatorDto;

  @IsOptional()
  @IsEnum(["forward", "backward", "around"])
  direction: "forward" | "backward" | "around" = "forward";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(50000)
  maxChars = 4000;
}

export class BookReadFromTocDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(256, { each: true })
  nodeIds?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300_000)
  cursor?: string;
}

export class BookTextSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit = 10;
}

export class BookSemanticSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK = 8;
}

export class BookAnnotationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsBoolean()
  hasNote?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(["highlight", "underline", "squiggly"], { each: true })
  types?: Array<"highlight" | "underline" | "squiggly">;
}
