const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

// Test hydration of cached pages
async function testCachedPageHydration(cacheDir = "./cache") {
  console.log("🔍 Testing cached page hydration...\n");

  try {
    // Get all cache directories
    const cacheDirs = await fs.readdir(cacheDir);

    for (const hash of cacheDirs) {
      if (hash.startsWith(".")) continue;

      const hashPath = path.join(cacheDir, hash);
      const stats = await fs.stat(hashPath);

      if (!stats.isDirectory()) continue;

      console.log(`\n📦 Cache: ${hash}`);
      console.log("─".repeat(50));

      try {
        // Read manifest
        const manifestPath = path.join(hashPath, "manifest.json");
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        console.log(`URL: ${manifest.url}`);
        console.log(`Cached at: ${manifest.cached_at}`);
        console.log(`Pages: ${manifest.pages.length}`);
        console.log(`Assets: ${manifest.assets.length}`);

        // Check main index.html
        const indexPath = path.join(hashPath, "index.html");
        const indexHtml = await fs.readFile(indexPath, "utf8");

        // Check for critical hydration elements
        const checks = {
          "Has <base> tag": indexHtml.includes("<base href"),
          "Has offline banner": indexHtml.includes("Cached Content"),
          "Has fallback script": indexHtml.includes("initFallbacks"),
          "URLs rewritten":
            !indexHtml.includes("https://") || indexHtml.includes("./assets/"),
          "Has CSS links": indexHtml.includes("./assets/styles/"),
          "Has JS scripts": indexHtml.includes("./assets/scripts/"),
          "Has images": indexHtml.includes("./assets/images/"),
        };

        console.log("\nHydration checks:");
        for (const [check, passed] of Object.entries(checks)) {
          console.log(`  ${passed ? "✅" : "❌"} ${check}`);
        }

        // Check asset counts
        const assetsPath = path.join(hashPath, "assets");
        if (
          await fs
            .access(assetsPath)
            .then(() => true)
            .catch(() => false)
        ) {
          const assetTypes = ["styles", "scripts", "images", "fonts", "data"];
          console.log("\nAsset counts:");

          for (const type of assetTypes) {
            const typePath = path.join(assetsPath, type);
            try {
              const files = await fs.readdir(typePath);
              const count = files.filter((f) => !f.startsWith(".")).length;
              if (count > 0) {
                console.log(`  ${type}: ${count} files`);
              }
            } catch (e) {
              // Directory might not exist
            }
          }
        }

        // Check for any absolute URLs that weren't rewritten
        const absoluteUrls =
          indexHtml.match(/(?:href|src)="https?:\/\/[^"]+"/g) || [];
        if (absoluteUrls.length > 0) {
          console.log(`\n⚠️  Found ${absoluteUrls.length} absolute URLs:`);
          absoluteUrls.slice(0, 5).forEach((url) => {
            console.log(`    ${url}`);
          });
        }

        // Check for React/Next.js specific elements
        const reactChecks = {
          "Has __NEXT_DATA__": indexHtml.includes("__NEXT_DATA__"),
          "Has React root":
            indexHtml.includes("__next") || indexHtml.includes("react-root"),
          "Has hydration scripts":
            indexHtml.includes("ReactDOM.hydrate") ||
            indexHtml.includes("hydrateRoot"),
        };

        const hasReact = Object.values(reactChecks).some((v) => v);
        if (hasReact) {
          console.log("\n⚛️  React/Next.js detected:");
          for (const [check, found] of Object.entries(reactChecks)) {
            if (found) console.log(`  ✓ ${check}`);
          }
        }
      } catch (err) {
        console.log(`❌ Error reading cache: ${err.message}`);
      }
    }

    console.log("\n✨ Hydration test complete!");
  } catch (err) {
    console.error("Error running hydration test:", err);
  }
}

// Run the test
testCachedPageHydration();
