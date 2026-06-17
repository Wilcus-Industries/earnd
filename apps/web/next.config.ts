import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the shared workspace package (it ships raw TS).
  transpilePackages: ["@earnd/contracts"],
};

export default nextConfig;
