/** @type {import('next').NextConfig} */
const rawBasePath = process.env.SITE_BASE_PATH || "";
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? rawBasePath.startsWith("/")
      ? rawBasePath.replace(/\/+$/, "")
      : `/${rawBasePath.replace(/\/+$/, "")}`
    : "";

const nextConfig = {
  output: "export",
  ...(basePath ? { basePath, assetPrefix: `${basePath}/` } : {}),
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
