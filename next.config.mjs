/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pg", "ioredis", "bcryptjs"],
  },
};

export default nextConfig;
