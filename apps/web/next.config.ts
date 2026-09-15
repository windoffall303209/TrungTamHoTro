import type { NextConfig } from "next";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: "../../.env" });

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
  },
  poweredByHeader: false,
  reactStrictMode: true,
  /** Apply baseline protections to documents and static responses on the web origin. */
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
