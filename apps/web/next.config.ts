import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@enterprise-ai/shared'],
};

export default nextConfig;
