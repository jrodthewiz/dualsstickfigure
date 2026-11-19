const basePath = process.env.STICKFIGURE_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  outputFileTracingRoot: __dirname,
  env: { NEXT_PUBLIC_STICKFIGURE_BASE_PATH: basePath },
  images: { unoptimized: true },
  trailingSlash: true,
  // assetPrefix removed - causes issues with absolute paths on Vercel
};

module.exports = nextConfig;
