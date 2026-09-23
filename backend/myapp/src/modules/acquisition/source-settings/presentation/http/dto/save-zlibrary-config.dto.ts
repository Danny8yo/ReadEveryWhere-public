import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, IsUrl, MinLength } from "class-validator";

export class SaveZlibraryConfigDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "Invalid URL format (https required)" })
  baseUrl!: string;
}
