import { IsIn, IsNotEmpty } from "class-validator";
import { CreateBookDto } from "./create-book.dto";
import { EBOOK_FORMATS, type EbookFormat } from "../../../../public/ebook-format";

export class AddFromSearchDto extends CreateBookDto {
  @IsNotEmpty()
  sourcePlatform!: string;

  @IsNotEmpty()
  sourceBookId!: string;

  @IsIn(EBOOK_FORMATS)
  format!: EbookFormat;
}
