export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/home/:path*", "/orders/:path*", "/settings/:path*", "/create"],
};
