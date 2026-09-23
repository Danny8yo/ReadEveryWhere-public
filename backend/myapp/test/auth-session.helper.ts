/** Browser credentials for isolated HTTP tests; never expose these in API JSON. */
export function authCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : [header];
  const session = cookies.find(
    (cookie): cookie is string => typeof cookie === "string" && cookie.startsWith("re_session="),
  );
  if (!session) throw new Error("Authentication response is missing re_session Set-Cookie");
  return session.split(";", 1)[0]!;
}

export function sessionHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: "http://localhost:5173" };
}
