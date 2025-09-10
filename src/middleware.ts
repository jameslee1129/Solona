import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Skip static and API for auth gating logic; handle /login specially below
  if (pathname.startsWith("/api") || pathname.startsWith("/_next") || pathname.startsWith("/public")) {
    return NextResponse.next();
  }
  const cookie = req.headers.get("cookie") || "";
  const getCookie = (name: string): string | undefined => {
    const parts = cookie.split(/;\s*/);
    for (const p of parts) {
      const [k, ...vals] = p.split("=");
      if (k === name) return decodeURIComponent(vals.join("="));
    }
    return undefined;
  };
  const session = getCookie("app_session");
  const isAuthed = typeof session === "string" && session.length > 0;
  // If visiting /login while authenticated, redirect to home
  if (pathname === "/login" && isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  if (!isAuthed && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};

