import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@costing/types', '@costing/validators', '@costing/config'],
  // Self-contained server for the Docker image; the trace root is the monorepo so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../'),
  poweredByHeader: false,
};
export default nextConfig;
