const exporting = process.env.BUILD_DEMO === "1";
const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(exporting ? { output: "export" } : {
    // Allow for Overpass's road-download timeout before the proxy gives up.
    experimental: { proxyTimeout: 240_000 },
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
    },
  }),
};
export default nextConfig;
