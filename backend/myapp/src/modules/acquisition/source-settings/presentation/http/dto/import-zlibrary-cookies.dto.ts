import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsUrl, Matches, MaxLength } from "class-validator";

const COOKIE_VALUE_PATTERN = /^[^;\r\n]+$/;

export class ImportZlibraryCookiesDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Matches(COOKIE_VALUE_PATTERN, { message: "remixUserid contains invalid Cookie characters" })
  remixUserid!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Matches(COOKIE_VALUE_PATTERN, { message: "remixUserkey contains invalid Cookie characters" })
  remixUserkey!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "Invalid URL format (https required)" })
  baseUrl!: string;
}
