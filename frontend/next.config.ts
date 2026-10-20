import type { NextConfig } from 'next';

const api = process.env.GNA_API_URL || 'http://127.0.0.1:8000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // REST is proxied through Next; the WebSocket connects to the API directly (see lib/api.ts).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
