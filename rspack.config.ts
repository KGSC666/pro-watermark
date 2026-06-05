import * as path from "path";
import { defineConfig } from "@rspack/cli";
import * as rspack from "@rspack/core";

export default defineConfig({
  context: __dirname,
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
