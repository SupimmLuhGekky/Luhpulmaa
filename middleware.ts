import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast path only: bounce requests without a session cookie away from app pages.
 * Real authentication (session lookup, expiry, ownership) happens server-side in
 * every page, server action and API route — never trust this check alone.
 */
const SESSION_COOKIE = "harbour_session";
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email", "/legal", "/api", "/demo"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|.*\\.(?:png|jpg|svg|webp|ico|txt)$).*)"],
};
