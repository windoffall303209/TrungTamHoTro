import type { NextConfig } from "next";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: "../../.env" });

const nextConfig: NextConfig = {
  agentRules: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
