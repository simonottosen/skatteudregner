/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  sassOptions: {
    loadPaths: ["node_modules"],
    quietDeps: true,
    silenceDeprecations: [
      "global-builtin",
      "import",
      "legacy-js-api",
      "color-functions",
    ],
  },
}

export default nextConfig
