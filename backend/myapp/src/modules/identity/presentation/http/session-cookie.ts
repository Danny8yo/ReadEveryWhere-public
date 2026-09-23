import type { Request, Response } from "express";
import { IdentityApplicationError } from "../../application/identity-application.error";
export const SESSION_COOKIE = "re_session";
export function cookieSecureMode(): "auto" | "true" | "false" {
  const mode = process.env.SESSION_COOKIE_SECURE ?? "auto";
  if (mode !== "auto" && mode !== "true" && mode !== "false")
    throw new Error("SESSION_COOKIE_SECURE must be auto, true or false");
  return mode;
}
export function sessionCookie(req: Request): string | undefined {
  const values = (req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (values.length > 1)
    throw IdentityApplicationError.unauthorized("Ambiguous session cookie");
  return values.length ? values[0].slice(SESSION_COOKIE.length + 1) : undefined;
}
export function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  absoluteExpiresAt: number,
) {
  const mode = cookieSecureMode();
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: mode === "true" || (mode === "auto" && req.secure),
    sameSite: "lax",
    path: "/api",
    expires: new Date(absoluteExpiresAt),
  });
  res.setHeader("Cache-Control", "no-store");
}
export function clearSessionCookie(req: Request, res: Response) {
  const mode = cookieSecureMode();
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: mode === "true" || (mode === "auto" && req.secure),
    sameSite: "lax",
    path: "/api",
  });
}
export function assertTrustedOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim());
  const ownOrigin = `${req.protocol}://${req.get("host")}`;
  if (
    !origin ||
    origin === "null" ||
    (origin !== ownOrigin && !allowed.includes(origin))
  )
    throw IdentityApplicationError.forbidden(
      "Untrusted or missing request Origin",
    );
}
