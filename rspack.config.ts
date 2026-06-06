import * as path from "path";
import { defineConfig } from "@rspack/cli";
import * as rspack from "@rspack/core";

// Read the mode straight from the CLI args (the npm scripts pass `--mode`).
// defineConfig in rspack 0.5 only takes a plain object, not a function, so we
// resolve it here at module load instead of from a config callback.
const modeIdx = process.argv.indexOf("--mode");
const isProd =
  (modeIdx !== -1 ? process.argv[modeIdx + 1] : process.env.NODE_ENV) === "production";

export default defineConfig({
  context: __dirname,
  // No source maps in the production build: the 7MB .map only bloats the deploy
  // and exposes source. Keep them while developing for debuggable stack traces.
  devtool: isProd ? false : "eval-cheap-module-source-map",
  entry: {
    main: "./src/app/main.tsx",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    extensions: ["...", ".ts", ".tsx"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                parser: {
                  syntax: "typescript",
                  tsx: true,
                },
                transform: {
                  react: {
                    runtime: "automatic",
                  },
                },
              },
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader", "postcss-loader"],
        type: "javascript/auto",
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    port: 8080,
    hot: true,
  },
  builtins: {
    // Rspack 0.5.9 builtins configuration
    treeShaking: true,
  },
});
