import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// A changed app build also changes the worker, enabling the in-app update prompt.
function versionWorker() {
  return {
    name: "hyte-version-worker",
    async closeBundle() {
      const html = await readFile("dist/index.html", "utf8");
      const revision = createHash("sha256")
        .update(html)
        .digest("hex")
        .slice(0, 12);
      const worker = await readFile("public/sw.js", "utf8");
      await writeFile(
        "dist/sw.js",
        worker.replace("hyte-shell-v1", `hyte-shell-${revision}`),
      );
    },
  };
}
export default defineConfig({
  plugins: [react(), versionWorker()],
  build: { chunkSizeWarningLimit: 650, target: "safari16.4" },
});
