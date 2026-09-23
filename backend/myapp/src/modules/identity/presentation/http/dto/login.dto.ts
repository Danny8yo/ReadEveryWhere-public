import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  email!: string;

  // 登录不应校验密码长度/复杂度（会泄露密码策略，且卡住历史口令）；
  // 仅限制非空 + 一个宽松上限防御超长输入。
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
