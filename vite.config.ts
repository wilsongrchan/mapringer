import { defineConfig } from "vite";

// Relative base by default: gamerabbit.io serves this build at /mapringer/ through a
// rewrite, so absolute /assets/... paths would 404 there. GitHub Pages can still
// override it with BASE_PATH=/<repo>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
});
