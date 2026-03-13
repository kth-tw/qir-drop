import { defineConfig } from "vite";

export default defineConfig({
  base: "/qir-drop/",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
  },
});
