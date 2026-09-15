/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma を Vercel のサーバーレス関数にバンドルしない
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};
export default nextConfig;
