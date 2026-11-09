import { defineConfig } from "vite";

// On GitHub Pages the site lives at /<repo>/, so assets and data need that base path.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
});
