import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token as { role?: string } | null;
    const { pathname } = req.nextUrl;

    // Unauthenticated access to candidate portal → candidate login
    if (!token && pathname.startsWith("/candidate")) {
      return NextResponse.redirect(new URL("/candidate-auth", req.url));
    }

    // Candidates must stay in candidate area
    if (token?.role === "candidate") {
      if (!pathname.startsWith("/candidate") && !pathname.startsWith("/api") && pathname !== "/candidate-auth") {
        return NextResponse.redirect(new URL("/candidate", req.url));
      }
    }

    // Non-candidates cannot access candidate portal
    if (pathname.startsWith("/candidate") && token?.role !== "candidate") {
      return NextResponse.redirect(new URL("/candidate-auth", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ token, req }) {
        const { pathname } = req.nextUrl;
        // Candidate routes: always let through (middleware handles the redirect)
        if (pathname.startsWith("/candidate")) return true;
        // All other protected routes: require any valid token
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/",
    "/new",
    "/dashboard/:path*",
    "/review/:path*",
    "/questions/:path*",
    "/compare/:path*",
    "/team/:path*",
    "/templates/:path*",
    "/jobs/:path*",
    "/admin/:path*",
    "/candidate",
    "/candidate/:path*",
  ],
};
