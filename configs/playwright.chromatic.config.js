import { defineConfig, devices } from "@playwright/test";

/**
 * Viewports every snapshot is captured at.
 *
 * Chromatic's Playwright integration has no viewport option of its own: it
 * replays the archived page at whatever viewport the Playwright run recorded,
 * so covering a width means running the suite at that width.  Only the
 * viewport is emulated — the device descriptors for real phones run on WebKit,
 * which the Chromatic workflow does not install, and Chromatic replays the
 * archive in its own browser regardless.
 *
 * `undefined` keeps the Desktop Chrome default (1280x720).
 */
const VIEWPORTS = [
    { name: "desktop", viewport: undefined },
    { name: "tablet", viewport: { width: 768, height: 1024 } },
    { name: "mobile", viewport: { width: 390, height: 844 } },
];

export default defineConfig({
    testDir: "../tests/chromatic",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [["html", { outputFolder: "../playwright-report-chromatic", open: "never" }]],
    use: {
        baseURL: "http://localhost:5173",
        trace: "on-first-retry",
        launchOptions: {
            args: ["--disable-gpu"],
        },
    },
    projects: VIEWPORTS.map(({ name, viewport }) => ({
        name,
        use: { ...devices["Desktop Chrome"], ...(viewport ? { viewport } : {}) },
    })),
    webServer: {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
    },
});
