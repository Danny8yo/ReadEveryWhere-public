import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AiAccessTokenService } from "../../../application/ai-access-token.service";
import { IdentityApplicationError } from "../../../application/identity-application.error";
import { AI_ACCESS_TOKEN_PREFIX } from "../../../domain/ai-access-token.types";
import { SessionService } from "../../../application/session.service";
import { assertTrustedOrigin, sessionCookie } from "../session-cookie";
import { AI_ACCESS_SCOPES_KEY } from "../../../public/allow-ai-access.decorator";
import { PUBLIC_ROUTE_KEY } from "../../../../../platform/http/public-route";
import { throwIdentityHttpError } from "../identity-error.mapper";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly aiAccessTokens: AiAccessTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      const isPublic = this.reflector.getAllAndOverride<boolean>(
        PUBLIC_ROUTE_KEY,
        [context.getHandler(), context.getClass()],
      );
      const request = context.switchToHttp().getRequest<Request>();
      context
        .switchToHttp()
        .getResponse()
        .setHeader("Cache-Control", "no-store");
      const authorization = request.header("authorization");
      if (
        !isPublic &&
        authorization?.startsWith(`Bearer ${AI_ACCESS_TOKEN_PREFIX}`)
      ) {
        return this.activateAiAccessToken(
          context,
          request,
          authorization.slice(7).trim(),
        );
      }
      assertTrustedOrigin(request);
      if (isPublic) return true;
      const token = sessionCookie(request);
      if (!token)
        throw IdentityApplicationError.unauthorized("Missing session cookie");
      const session = this.sessions.authenticate(token);
      request.user = {
        userId: session.userId,
        email: session.email,
        authType: "session",
        sessionId: session.id,
      };
      return true;
    } catch (error) {
      throwIdentityHttpError(error);
    }
  }

  private activateAiAccessToken(
    context: ExecutionContext,
    request: Request,
    token: string,
  ): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<
      Array<"books:read" | "annotations:read">
    >(AI_ACCESS_SCOPES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredScopes?.length) {
      throw IdentityApplicationError.forbidden(
        "AI access tokens can only call explicitly allowed read-only endpoints",
      );
    }

    const principal = this.aiAccessTokens.verify(token);
    if (!principal) {
      throw IdentityApplicationError.unauthorized(
        "Invalid, expired, or revoked AI access token",
      );
    }
    if (!requiredScopes.every((scope) => principal.scopes.includes(scope))) {
      throw IdentityApplicationError.forbidden(
        "AI access token does not include the required read scope",
      );
    }

    request.user = {
      userId: principal.userId,
      email: principal.email,
      authType: "ai_access_token",
      aiTokenId: principal.tokenId,
      scopes: principal.scopes,
    };
    return true;
  }
}
