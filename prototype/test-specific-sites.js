const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

// Test specific problematic sites
async function testSpecificSites() {
  const problematicSites = [
    "https://www.browserstack.com",
    "https://code.visualstudio.com",
  ];

  console.log("🔍 Testing specific problematic sites...\n");

  // First, let's check if these sites are cached
  const cacheDir = "./cache";

  for (const url of problematicSites) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log("=".repeat(60));

    // Generate the same hash as the server would
    const normalizedUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    const hash = crypto
      .createHash("md5")
      .update(normalizedUrl)
      .digest("hex")
      .substring(0, 16);

    console.log(`Expected cache hash: ${hash}`);

    const cachePath = path.join(cacheDir, hash);

    try {
      // Check if cache exists
      await fs.access(cachePath);
      console.log("✅ Cache directory exists");

      // Check manifest
      const manifestPath = path.join(cachePath, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

      console.log(`\n📊 Cache Statistics:`);
      console.log(`  URL: ${manifest.url}`);
      console.log(`  Cached at: ${manifest.cached_at}`);
      console.log(`  Pages: ${manifest.pages?.length || 0}`);
      console.log(`  Assets: ${manifest.assets?.length || 0}`);
      console.log(
        `  Errors: ${
          manifest.errors ? JSON.stringify(manifest.errors) : "None"
        }`
      );

      // Check index.html
      const indexPath = path.join(cachePath, "index.html");
      const indexContent = await fs.readFile(indexPath, "utf8");

      console.log(`\n📄 HTML Analysis:`);
      console.log(`  Size: ${(indexContent.length / 1024).toFixed(2)} KB`);
      console.log(
        `  Has <base> tag: ${
          indexContent.includes("<base href") ? "Yes" : "No"
        }`
      );
      console.log(
        `  Has offline banner: ${
          indexContent.includes("Cached Content") ? "Yes" : "No"
        }`
      );
      console.log(
        `  Has CSS links: ${
          indexContent.includes("./assets/styles/") ? "Yes" : "No"
        }`
      );
      console.log(
        `  Has JS scripts: ${
          indexContent.includes("./assets/scripts/") ? "Yes" : "No"
        }`
      );

      // Check for inline styles (might indicate simple HTML scraping)
      const hasInlineStyles =
        indexContent.includes("<style>") || indexContent.includes('style="');
      console.log(`  Has inline styles: ${hasInlineStyles ? "Yes" : "No"}`);

      // Check asset directories
      const assetTypes = ["styles", "scripts", "images"];
      console.log(`\n📁 Asset Files:`);

      for (const type of assetTypes) {
        try {
          const assetPath = path.join(cachePath, "assets", type);
          const files = await fs.readdir(assetPath);
          const count = files.filter((f) => !f.startsWith(".")).length;
          console.log(`  ${type}: ${count} files`);

          if (count === 0 && type === "styles") {
            console.log(
              `    ⚠️  No CSS files - this explains the bare HTML appearance!`
            );
          }
        } catch (e) {
          console.log(`  ${type}: Directory not found`);
        }
      }

      // Check for specific issues
      console.log(`\n🔍 Potential Issues:`);

      // Check for anti-bot indicators
      if (
        indexContent.includes("cf-challenge") ||
        indexContent.includes("challenge-platform") ||
        indexContent.includes("_cf_bm") ||
        indexContent.includes("cf-turnstile")
      ) {
        console.log(`  ⚠️  Cloudflare protection detected`);
      }

      if (
        indexContent.includes("recaptcha") ||
        indexContent.includes("grecaptcha")
      ) {
        console.log(`  ⚠️  reCAPTCHA detected`);
      }

      // Check for loading screens
      if (
        (indexContent.includes("loading") &&
          indexContent.includes("spinner")) ||
        indexContent.includes("Please wait")
      ) {
        console.log(
          `  ⚠️  Loading screen detected - page might not have fully rendered`
        );
      }

      // Check for noscript warnings
      if (
        indexContent.includes("<noscript>") &&
        indexContent.includes("JavaScript")
      ) {
        console.log(
          `  ⚠️  Site requires JavaScript and might not render properly`
        );
      }

      // Check first 500 chars of content
      console.log(`\n📝 First 500 chars of HTML:`);
      console.log(indexContent.substring(0, 500) + "...");
    } catch (err) {
      console.log(`❌ Cache not found or error: ${err.message}`);
    }
  }

  console.log("\n\n✨ Test complete!");
}

// Run the test
testSpecificSites();
