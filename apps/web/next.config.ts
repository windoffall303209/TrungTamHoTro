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
  /** Áp header bảo mật nền cho mọi phản hồi và chính sách cache an toàn cho tài nguyên ảnh/font công khai. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
      {
        source: "/:asset(.*\\.(?:jpg|jpeg|png|webp|avif|gif|ico|woff|woff2))",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
