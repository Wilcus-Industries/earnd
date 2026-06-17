import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // The shared package ships raw TS; let vitest transform it.
    server: { deps: { inline: [/@earnd\/contracts/] } },
  },
});
