import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test of the deployed site, over live data.
 * Every other suite stands in for the network, which is what keeps them
 * stable and also what leaves them blind to a change upstream.  This one is run
 * daily rather than on pull requests, so that an upstream outage raises an
 * alert rather than turning unrelated pull requests red.
 *
 * Point it elsewhere, such as a pull request's preview, with LIVE_URL.
 */
export default defineConfig({
    testDir: "../tests/live",
    forbidOnly: !!process.env.CI,
    // The page loads megabytes of live data, so the time limits are generous.
    timeout: 120_000,
    expect: { timeout: 60_000 },
    // One retry absorbs a passing blip on the network; anything that fails
    // twice in a row is worth an email.
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [["list"], ["html", { outputFolder: "../playwright-report-live", open: "never" }]],
    use: {
        baseURL: process.env.LIVE_URL || "https://usage.dandiarchive.org",
        trace: "retain-on-failure",
        launchOptions: {
            args: ["--disable-gpu"],
        },
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
