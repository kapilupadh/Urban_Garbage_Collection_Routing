/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.BUILD_DEMO === "1" ? "export" : undefined,
};
export default nextConfig;
