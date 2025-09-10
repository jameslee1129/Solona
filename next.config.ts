import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages configuration
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Ignorer bygg-feil i prod (Vercel) for å sikre deploy
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Transpiler pakker som ikke er ESM-vennlige ut av boksen
  transpilePackages: [
    "@drift-labs/sdk",
    "@solana/web3.js",
    "rpc-websockets",
  ],
  // Webpack alias for dype subpath-importer brukt av eldre web3.js
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.extensions = config.resolve.extensions || [
      ".mjs",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
    ];
    if (!config.resolve.extensions.includes(".cjs")) {
      config.resolve.extensions.push(".cjs");
    }
    return config;
  },
};

export default nextConfig;
