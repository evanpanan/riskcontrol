const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

module.exports = (phase) => {
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    reactStrictMode: true,
    // Keep production builds from replacing files served by the running dev server.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // 显式锁定工作区根目录：上级目录若存在其它 lockfile，Next 会误判根目录并扩大监听范围。
    outputFileTracingRoot: __dirname,
  };
  return nextConfig;
};
