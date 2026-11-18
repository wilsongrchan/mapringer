import { defineConfig } from "vite";

// Relative base by default: gamerabbit.io serves this build at /mapringer/ through a
// rewrite, so absolute /assets/... paths would 404 there. GitHub Pages can still
// override it with BASE_PATH=/<repo>/.
//
// NEXT_PUBLIC_SUPABASE_* (URL and the publishable/anon key, both public by design)
// come from the Supabase integration on Vercel; nothing else from the env reaches
// the browser. (Never prefix a secret like SUPABASE_SECRET_KEY into the build.)
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  envPrefix: ["VITE_", "NEXT_PUBLIC_SUPABASE_"],
});
