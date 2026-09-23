import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AiAccessTokenService } from "../../../application/ai-access-token.service";
import { AuthService } from "../../../application/auth.service";
import { RegistrationPolicy } from "../../../application/registration-policy";
import type { AuthResponse } from "../../../domain/auth.types";
import { Public } from "../../../public/public.decorator";
import { CreateAiAccessTokenDto } from "../dto/create-ai-access-token.dto";
import { LoginDto } from "../dto/login.dto";
import { setSessionCookie, clearSessionCookie } from "../session-cookie";
import { RegisterDto } from "../dto/register.dto";
import { ResetPasswordDto } from "../dto/reset-password.dto";
import { throwIdentityHttpError } from "../identity-error.mapper";
import { RegistrationEnabledGuard } from "../guards/registration-enabled.guard";

@Controller("api/v1/auth")
@Throttle({ default: { limit: 5, ttl: 600000 } })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly aiAccessTokens: AiAccessTokenService,
    private readonly registrationPolicy: RegistrationPolicy,
  ) {}

  @Public()
  @Post("register")
  @HttpCode(201)
  @UseGuards(RegistrationEnabledGuard)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.register(dto);
      setSessionCookie(req, res, result.token, result.absoluteExpiresAt);
      return { user: result.user };
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Public()
  @SkipThrottle()
  @Get("registration-status")
  @Header("Cache-Control", "no-store")
  registrationStatus(): { registrationEnabled: boolean } {
    return { registrationEnabled: this.registrationPolicy.isEnabled() };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.login(dto);
      setSessionCookie(req, res, result.token, result.absoluteExpiresAt);
      return { user: result.user };
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Get("session")
  @SkipThrottle()
  @Header("Cache-Control", "no-store")
  session(@Req() req: Request): AuthResponse {
    return { user: { userId: req.user!.userId, email: req.user!.email } };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    try {
      await this.authService.logout(req.user!.sessionId!);
      clearSessionCookie(req, res);
      return { message: "Logged out successfully" };
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.resetPassword(
        req.user!.userId,
        dto,
      );
      setSessionCookie(req, res, result.token, result.absoluteExpiresAt);
      return { user: result.user };
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Post("ai-tokens")
  @HttpCode(201)
  createAiAccessToken(
    @Body() dto: CreateAiAccessTokenDto,
    @Req() req: Request,
  ) {
    try {
      return this.aiAccessTokens.create(
        req.user!.userId,
        dto.name,
        dto.expiresInDays,
      );
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Get("ai-tokens")
  listAiAccessTokens(@Req() req: Request) {
    try {
      return this.aiAccessTokens.list(req.user!.userId);
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  @Delete("ai-tokens/:id")
  revokeAiAccessToken(@Param("id") id: string, @Req() req: Request) {
    try {
      return this.aiAccessTokens.revoke(req.user!.userId, id);
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }
}
