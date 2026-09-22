import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
};

export default withMDX(config);
