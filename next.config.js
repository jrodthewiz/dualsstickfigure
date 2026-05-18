/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  trailingSlash: true,
  // assetPrefix removed - causes issues with absolute paths on Vercel
};

module.exports = nextConfig;
