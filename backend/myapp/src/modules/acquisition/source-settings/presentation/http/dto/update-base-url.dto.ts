import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsUrl } from "class-validator";

export class UpdateBaseUrlDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "Invalid URL format (https required)" })
  baseUrl!: string;
}
