import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

let gitHash = "unknown";
try {
    gitHash = execSync("git rev-parse --short=8 HEAD").toString().trim();
} catch {
    // Not a git repo or git not available; leave as "unknown"
}

export default defineConfig({
    root: "src",
    publicDir: "configs",
    base: "./",
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __GIT_HASH__: JSON.stringify(gitHash),
    },
});
