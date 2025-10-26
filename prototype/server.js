const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const mime = require("mime-types");

const app = express();
const PORT = 3000;
const CACHE_DIR = path.join(__dirname, "cache");

app.use(express.json());
app.use(express.static(__dirname));

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error("Error creating cache directory:", err);
  }
}

// Generate hash from URL for cache directory name
function generateHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex").substring(0, 16);
}

// Normalize URL to handle trailing slashes, protocols, etc.
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname.replace(/\/$/, "") + urlObj.search;
  } catch (e) {
    return url;
  }
}

// Get file extension from content type or URL
function getFileExtension(contentType, url) {
  if (contentType) {
    const ext = mime.extension(contentType.split(";")[0].trim());
    if (ext) return `.${ext}`;
  }

  try {
    const urlObj = new URL(url);

    // Handle Next.js image URLs
    if (urlObj.pathname.includes("/_next/image")) {
      const imageUrl = urlObj.searchParams.get("url");
      if (imageUrl) {
        // Extract extension from the original image URL
        const match = imageUrl.match(/\.[a-z0-9]+$/i);
        return match ? match[0] : ".jpg"; // Default to .jpg for Next images
      }
    }

    const match = urlObj.pathname.match(/\.[a-z0-9]+$/i);
    return match ? match[0] : ".bin";
  } catch (e) {
    return ".bin";
  }
}

// Determine asset category
function getAssetCategory(contentType, url) {
  if (!contentType) {
    const ext = path.extname(url).toLowerCase();
    if ([".css"].includes(ext)) return "styles";
    if ([".js"].includes(ext)) return "scripts";
    if (
      [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico"].includes(ext)
    )
      return "images";
    if ([".woff", ".woff2", ".ttf", ".otf", ".eot"].includes(ext))
      return "fonts";
    return "misc";
  }

  const type = contentType.split(";")[0].trim();
  if (type.includes("css")) return "styles";
  if (type.includes("javascript")) return "scripts";
  if (type.includes("image")) return "images";
  if (type.includes("font")) return "fonts";
  if (type.includes("json")) return "data";
  return "misc";
}

// Rewrite URLs in HTML content
function rewriteHtmlUrls(html, baseUrl, urlMapping, cacheHash) {
  const baseUrlObj = new URL(baseUrl);
  const origin = baseUrlObj.origin;

  // Replace absolute URLs with mapped local paths
  let rewritten = html;

  // Sort by length (longest first) to avoid partial replacements
  const sortedMappings = Object.entries(urlMapping).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [originalUrl, localPath] of sortedMappings) {
    // Escape special regex characters in URL
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Also create HTML-encoded version for Next.js URLs
    const htmlEncodedUrl = originalUrl
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const escapedHtmlUrl = htmlEncodedUrl.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    // Replace in various HTML contexts
    const patterns = [
      new RegExp(`(href|src)=["']${escapedUrl}["']`, "gi"),
      new RegExp(`(href|src)=["']${escapedHtmlUrl}["']`, "gi"),
      new RegExp(
        `(href|src)=["']${escapedUrl.replace(/^https?:/, "")}["']`,
        "gi"
      ),
      new RegExp(`url\\(["']?${escapedUrl}["']?\\)`, "gi"),
      // Also handle in srcset where URLs might be standalone
      new RegExp(`${escapedUrl}(\\s+\\d+w)?`, "gi"),
      new RegExp(`${escapedHtmlUrl}(\\s+\\d+w)?`, "gi"),
    ];

    patterns.forEach((pattern) => {
      rewritten = rewritten.replace(pattern, (match) => {
        if (match.includes("href=") || match.includes("src=")) {
          return match
            .replace(originalUrl, localPath)
            .replace(htmlEncodedUrl, localPath)
            .replace(originalUrl.replace(/^https?:/, ""), localPath);
        } else if (match.match(/\s+\d+w$/)) {
          // Handle srcset entries with width descriptors
          return match
            .replace(originalUrl, localPath)
            .replace(htmlEncodedUrl, localPath);
        } else {
          return `url('${localPath}')`;
        }
      });
    });
  }

  // Handle relative URLs - make them absolute to the cached location
  rewritten = rewritten.replace(
    /(href|src)=["'](?!http|\/\/|data:|#|mailto:|\.\/assets)([^"']+)["']/gi,
    (match, attr, relUrl) => {
      try {
        // Decode HTML entities in the relative URL
        const decodedUrl = relUrl
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");

        // For root-relative URLs like /_next/image, prepend the origin
        const absoluteUrl = decodedUrl.startsWith("/")
          ? new URL(decodedUrl, origin).href
          : new URL(decodedUrl, baseUrl).href;

        if (urlMapping[absoluteUrl]) {
          console.log(
            `  → Rewriting relative URL: ${relUrl} -> ${urlMapping[absoluteUrl]}`
          );
          return `${attr}="${urlMapping[absoluteUrl]}"`;
        }
      } catch (e) {
        // Keep original if URL construction fails
      }
      return match;
    }
  );

  // Handle srcset attributes for responsive images
  rewritten = rewritten.replace(
    /srcset=["']([^"']+)["']/gi,
    (match, srcset) => {
      const rewrittenSrcset = srcset
        .split(",")
        .map((entry) => {
          const trimmedEntry = entry.trim();
          // Extract URL and descriptor (like 640w or 2x)
          const parts = trimmedEntry.split(/\s+/);
          if (parts.length === 0) return trimmedEntry;

          const url = parts[0];
          const descriptor = parts.slice(1).join(" ");

          // Try to resolve and map the URL
          try {
            // Decode HTML entities first
            const decodedUrl = url
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">");

            let absoluteUrl;
            if (decodedUrl.startsWith("http") || decodedUrl.startsWith("//")) {
              absoluteUrl = decodedUrl.startsWith("//")
                ? `https:${decodedUrl}`
                : decodedUrl;
            } else if (decodedUrl.startsWith("/")) {
              // Handle root-relative URLs
              absoluteUrl = new URL(decodedUrl, origin).href;
            } else {
              absoluteUrl = new URL(decodedUrl, baseUrl).href;
            }

            if (urlMapping[absoluteUrl]) {
              return descriptor
                ? `${urlMapping[absoluteUrl]} ${descriptor}`
                : urlMapping[absoluteUrl];
            }
          } catch (e) {
            // Keep original on error
          }
          return trimmedEntry;
        })
        .join(", ");

      return `srcset="${rewrittenSrcset}"`;
    }
  );

  return rewritten;
}

// Rewrite URLs in CSS content
function rewriteCssUrls(css, baseUrl, urlMapping) {
  let rewritten = css;

  // Sort by length (longest first) to avoid partial replacements
  const sortedMappings = Object.entries(urlMapping).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [originalUrl, localPath] of sortedMappings) {
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`url\\(["']?${escapedUrl}["']?\\)`, "gi");
    rewritten = rewritten.replace(pattern, `url('${localPath}')`);
  }

  // Handle relative URLs in CSS
  rewritten = rewritten.replace(
    /url\(["']?(?!http|\/\/|data:)([^"')]+)["']?\)/gi,
    (match, relUrl) => {
      try {
        const absoluteUrl = new URL(relUrl.trim(), baseUrl).href;
        if (urlMapping[absoluteUrl]) {
          return `url('${urlMapping[absoluteUrl]}')`;
        }
      } catch (e) {
        // Keep original if URL construction fails
      }
      return match;
    }
  );

  return rewritten;
}

// Extract same-origin links from HTML
function extractSameOriginLinks(html, baseUrl) {
  const links = new Set();
  const baseUrlObj = new URL(baseUrl);

  const hrefPattern = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    try {
      const href = match[1];
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("javascript:")
      ) {
        continue;
      }

      const absoluteUrl = new URL(href, baseUrl);

      // Only include same-origin links
      if (absoluteUrl.origin === baseUrlObj.origin) {
        links.add(absoluteUrl.href);
      }
    } catch (e) {
      // Skip invalid URLs
    }
  }

  return Array.from(links);
}

// Main caching function
async function cachePage(url, options = {}) {
  const { maxDepth = 2, cookies = null } = options;
  const normalizedUrl = normalizeUrl(url);
  const cacheHash = generateHash(normalizedUrl);
  const cacheDir = path.join(CACHE_DIR, cacheHash);
  const assetsDir = path.join(cacheDir, "assets");
  const pagesDir = path.join(cacheDir, "pages");

  // Create directory structure
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(path.join(assetsDir, "styles"), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "images"), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "fonts"), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "data"), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "misc"), { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });

  // Add cookies if provided
  if (cookies) {
    await context.addCookies(cookies);
  }

  const urlMapping = {};
  const savedAssets = new Set();
  const manifest = {
    url: normalizedUrl,
    cached_at: new Date().toISOString(),
    pages: [],
    assets: [],
  };

  // Track pages to cache and already cached
  const pagesToCache = [{ url: normalizedUrl, depth: 0 }];
  const cachedPages = new Set();

  while (pagesToCache.length > 0) {
    const { url: pageUrl, depth } = pagesToCache.shift();

    if (cachedPages.has(pageUrl) || depth > maxDepth) {
      continue;
    }

    cachedPages.add(pageUrl);
    console.log(`Caching page (depth ${depth}): ${pageUrl}`);

    const page = await context.newPage();
    const pageResources = [];

    // Debug: Log page events to see what's happening
    page.on("close", () => {
      console.log(`  ⚠ PAGE CLOSE EVENT FIRED!`);
    });

    page.on("crash", () => {
      console.log(`  ⚠ PAGE CRASH EVENT FIRED!`);
    });

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`  → Frame navigated to: ${frame.url()}`);
      }
    });

    // Also capture requests to see what's being asked for
    page.on("request", (request) => {
      const url = request.url();
      // Log image requests
      if (
        url.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i) ||
        url.includes("/_next/image") ||
        url.includes("/logo") ||
        url.includes("/floor") ||
        url.includes("/venue") ||
        url.includes("/overvie") ||
        url.includes("favicon")
      ) {
        console.log(`  → Image request: ${url}`);
      }
    });

    // Intercept all network requests
    page.on("response", async (response) => {
      try {
        const responseUrl = response.url();
        const contentType = response.headers()["content-type"] || "";
        const status = response.status();

        // Skip failed requests
        if (status >= 400) {
          console.log(
            `  ⚠ Skipping failed request (${status}): ${responseUrl}`
          );
          return;
        }

        // Skip data URLs and blob URLs
        if (responseUrl.startsWith("data:") || responseUrl.startsWith("blob:"))
          return;

        // Always capture image-like responses
        const isImageUrl =
          responseUrl.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i) ||
          responseUrl.includes("/_next/image") ||
          responseUrl.includes("/logo") ||
          responseUrl.includes("/floor") ||
          responseUrl.includes("/venue") ||
          responseUrl.includes("/overvie") ||
          contentType.includes("image");

        // Log Next.js image requests specifically
        if (
          responseUrl.includes("/_next/image") ||
          responseUrl.includes("_next/image")
        ) {
          console.log(`  → Found Next.js image: ${responseUrl}`);
        }

        // Log SVG/PNG captures
        if (responseUrl.match(/\.(svg|png)$/i)) {
          console.log(
            `  → Found ${
              responseUrl.endsWith(".svg") ? "SVG" : "PNG"
            }: ${responseUrl}`
          );
        }

        pageResources.push({ url: responseUrl, contentType, response });

        if (isImageUrl) {
          console.log(
            `  → Captured image response: ${responseUrl} (${
              contentType || "no content-type"
            })`
          );
        }
      } catch (err) {
        console.error(`Error intercepting response: ${err.message}`);
      }
    });

    try {
      // Navigate and wait for network to be idle
      console.log(`  → Navigating to ${pageUrl}...`);
      await page.goto(pageUrl, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      console.log(
        `  → Navigation complete, page is ${
          page.isClosed() ? "CLOSED" : "OPEN"
        }`
      );

      console.log(`  → Waiting for content to load...`);
      // Wait a bit more for any lazy-loaded content
      await page.waitForTimeout(2000);

      console.log(`  → Scrolling to trigger lazy-loaded content...`);
      // Progressive scrolling to trigger lazy loading with hard cutoff
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const maxScrollHeight = viewportHeight * 5; // 5 viewport heights hard cutoff

      let currentScrollPosition = 0;
      let lastHeight = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 20; // Additional safety limit
      let totalAssetsBeforeScroll = pageResources.length;

      while (scrollAttempts < maxScrollAttempts) {
        // Check if page is still open before scrolling
        if (page.isClosed()) {
          console.log(`  ⚠ Page closed during scrolling, stopping early`);
          break;
        }

        try {
          // Get current document height
          const documentHeight = await page.evaluate(
            () => document.body.scrollHeight
          );

          // Check if we've hit our hard cutoff
          if (currentScrollPosition >= maxScrollHeight) {
            console.log(
              `  → Hit scroll limit (5 viewport heights), stopping scroll`
            );
            break;
          }

          // Check if the page height hasn't changed (no more content loading)
          if (documentHeight === lastHeight && scrollAttempts > 3) {
            console.log(`  → No new content detected, finishing scroll`);
            break;
          }

          lastHeight = documentHeight;

          // Scroll down by one full viewport height (was 0.5)
          currentScrollPosition += viewportHeight * 1.0;
          const scrollTarget = Math.min(
            currentScrollPosition,
            documentHeight,
            maxScrollHeight
          );

          // Use instant scroll for more reliable positioning
          await page.evaluate((scrollY) => {
            window.scrollTo({ top: scrollY, behavior: "instant" });
          }, scrollTarget);

          // Wait longer for content to actually appear
          await page.waitForTimeout(1000);

          // Force any lazy-loaded images to start loading by checking viewport
          await page.evaluate(() => {
            // Find all images and trigger intersection observer
            const images = document.querySelectorAll(
              'img[loading="lazy"], img[data-src]'
            );
            images.forEach((img) => {
              if (img.getBoundingClientRect().top < window.innerHeight * 2) {
                // Trigger lazy loading by setting src if needed
                if (img.dataset.src && !img.src) {
                  img.src = img.dataset.src;
                }
              }
            });
          });

          // Check for any pending network requests
          try {
            await page.waitForLoadState("networkidle", { timeout: 2000 });
          } catch (e) {
            // Continue even if network isn't completely idle
          }

          // Log progress
          const newAssets = pageResources.length - totalAssetsBeforeScroll;
          if (newAssets > 0) {
            console.log(
              `  → Found ${newAssets} new assets after scroll ${
                scrollAttempts + 1
              }`
            );
            totalAssetsBeforeScroll = pageResources.length;
          }

          scrollAttempts++;
        } catch (scrollError) {
          // Handle scroll errors gracefully
          console.warn(
            `  ⚠ Error during scroll attempt ${scrollAttempts}: ${scrollError.message}`
          );
          if (
            scrollError.message.includes("closed") ||
            scrollError.message.includes("crashed")
          ) {
            break; // Stop scrolling if page is gone
          }
          // Otherwise continue trying
        }
      }

      // Only scroll back if page is still open
      if (!page.isClosed()) {
        console.log(`  → Scrolling back to top...`);
        await page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: "instant" });
        });
        await page.waitForTimeout(500);
      } else {
        console.log(`  ⚠ Page closed, skipping scroll-to-top`);
      }

      console.log(`  → Scroll complete. Extracting content...`);

      // Check if page is still open before extracting content
      if (page.isClosed()) {
        throw new Error("Page closed before content could be extracted");
      }

      // Force load all images that might not have loaded
      console.log(`  → Force loading all images...`);
      const forcedImageUrls = await page.evaluate(() => {
        const images = [];

        // Find all img tags and get their sources
        document.querySelectorAll("img").forEach((img) => {
          if (img.src) {
            images.push(img.src);
          }

          // Also check srcset
          if (img.srcset) {
            const srcsetUrls = img.srcset
              .split(",")
              .map((entry) => entry.trim().split(" ")[0]);
            srcsetUrls.forEach((url) => {
              if (url) images.push(url);
            });
          }
        });

        // Also look for direct image references in the HTML that might not be in img tags yet
        const htmlContent = document.documentElement.innerHTML;
        const imagePatterns = [
          /src="([^"]*\.(svg|png|jpg|jpeg|webp))"/gi,
          /\/overvie[^"'\s]*/g,
          /\/venue[^"'\s]*/g,
          /\/floor[^"'\s]*/g,
          /\/logo\.png/g,
        ];

        imagePatterns.forEach((pattern) => {
          const matches = [...htmlContent.matchAll(pattern)];
          matches.forEach((match) => {
            const url = match[1] || match[0];
            if (url && !url.startsWith("data:")) {
              try {
                const absoluteUrl = new URL(url, window.location.href).href;
                images.push(absoluteUrl);
              } catch (e) {
                // If not a valid URL, add as-is
                images.push(url);
              }
            }
          });
        });

        return [...new Set(images)];
      });

      console.log(`  → Found ${forcedImageUrls.length} image URLs in page`);
      forcedImageUrls.slice(0, 10).forEach((url) => {
        console.log(`    - ${url}`);
      });
      if (forcedImageUrls.length > 10) {
        console.log(`    ... and ${forcedImageUrls.length - 10} more`);
      }

      // Navigate to each image URL to ensure it's captured
      console.log(`  → Fetching uncaptured images...`);
      for (const imageUrl of forcedImageUrls) {
        // Skip if already captured
        if (pageResources.some((r) => r.url === imageUrl)) continue;

        // Skip data URLs
        if (imageUrl.startsWith("data:")) continue;

        try {
          // Use page.evaluate to fetch the image
          await page.evaluate(async (url) => {
            try {
              await fetch(url);
            } catch (e) {
              // Ignore fetch errors
            }
          }, imageUrl);
        } catch (e) {
          // Ignore errors
        }
      }

      // Wait for any new resources to be captured
      await page.waitForTimeout(1000);

      // Get the rendered HTML
      const html = await page.content();

      // Debug: Log all captured resources
      console.log(`  → Total resources captured: ${pageResources.length}`);
      const imageResources = pageResources.filter(
        (r) =>
          r.url.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i) ||
          r.url.includes("/_next/image") ||
          r.url.includes("/logo") ||
          (r.contentType && r.contentType.includes("image"))
      );
      console.log(`  → Image resources found: ${imageResources.length}`);
      imageResources.forEach((img) => {
        console.log(
          `    - ${img.url} (${img.contentType || "no content-type"})`
        );
      });

      // Extract same-origin links if we haven't reached max depth
      if (depth < maxDepth) {
        const links = extractSameOriginLinks(html, pageUrl);
        for (const link of links) {
          if (!cachedPages.has(link)) {
            pagesToCache.push({ url: link, depth: depth + 1 });
          }
        }
      }

      // Save all intercepted resources
      console.log(`  → Saving ${pageResources.length} resources...`);
      let savedCount = 0;
      let imagesSaved = 0;
      let imagesFailed = 0;

      for (const { url: resourceUrl, contentType, response } of pageResources) {
        if (savedAssets.has(resourceUrl)) {
          console.log(`  → Skipping duplicate: ${resourceUrl}`);
          continue;
        }

        const isImage =
          resourceUrl.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i) ||
          resourceUrl.includes("/_next/image") ||
          resourceUrl.includes("/logo") ||
          (contentType && contentType.includes("image"));

        try {
          // Debug logging for images
          if (isImage) {
            console.log(`  → 🖼️ Processing image: ${resourceUrl}`);
            console.log(`    - Content-Type: ${contentType || "none"}`);
          }

          const buffer = await response.body();

          if (isImage) {
            console.log(`    - Buffer size: ${buffer.length} bytes`);
          }

          const category = getAssetCategory(contentType, resourceUrl);
          const ext = getFileExtension(contentType, resourceUrl);

          if (isImage) {
            console.log(`    - Category: ${category}, Extension: ${ext}`);
          }

          const resourceHash = crypto
            .createHash("md5")
            .update(resourceUrl)
            .digest("hex")
            .substring(0, 12);
          const fileName = `${resourceHash}${ext}`;
          const localPath = path.join(assetsDir, category, fileName);

          await fs.writeFile(localPath, buffer);

          // Map URL to local path (relative to cache directory)
          const relativePath = `./assets/${category}/${fileName}`;
          urlMapping[resourceUrl] = relativePath;

          savedAssets.add(resourceUrl);
          manifest.assets.push({
            original_url: resourceUrl,
            local_path: relativePath,
            content_type: contentType,
            size: buffer.length,
          });
          savedCount++;

          if (isImage) {
            imagesSaved++;
            console.log(`    ✅ Image saved successfully!`);
            console.log(`    - Local path: ${relativePath}`);
            console.log(`    - URL mapping: ${resourceUrl} -> ${relativePath}`);
          }

          // Log PNG and image saves specifically
          if (resourceUrl.includes(".png") || category === "images") {
            console.log(
              `  → Saved image: ${resourceUrl} (${ext}, ${buffer.length} bytes)`
            );
          }

          if (savedCount % 10 === 0) {
            console.log(
              `  → Saved ${savedCount}/${pageResources.length} assets...`
            );
          }
        } catch (err) {
          if (isImage) {
            imagesFailed++;
            console.error(`    ❌ Failed to save image!`);
          }
          console.warn(
            `  ⚠ Failed to save resource ${resourceUrl}: ${err.message}`
          );
        }
      }
      console.log(`  → Saved ${savedCount} assets total`);
      console.log(`  → Images: ${imagesSaved} saved, ${imagesFailed} failed`);

      // Debug: Check for logo.png in HTML before rewriting
      const logoMatches = html.match(/logo\.png/gi);
      if (logoMatches) {
        console.log(
          `  → Found ${logoMatches.length} references to logo.png in HTML`
        );
      }

      // Check all image sources in HTML
      const imgSrcs = html.match(/(?:src|srcset)=["']([^"']+)["']/gi);
      if (imgSrcs) {
        console.log(
          `  → Found ${imgSrcs.length} src/srcset attributes in HTML`
        );
        const imageUrls = imgSrcs.filter(
          (src) =>
            src.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)/i) ||
            src.includes("/_next/image") ||
            src.includes("/logo")
        );
        console.log(`  → ${imageUrls.length} appear to be image URLs`);
      }

      // Rewrite HTML URLs
      console.log(
        `  → Starting HTML rewriting with ${
          Object.keys(urlMapping).length
        } URL mappings`
      );
      let rewrittenHtml = rewriteHtmlUrls(html, pageUrl, urlMapping, cacheHash);

      // Rewrite CSS URLs in style tags
      rewrittenHtml = rewrittenHtml.replace(
        /<style[^>]*>([\s\S]*?)<\/style>/gi,
        (match, css) => {
          const rewrittenCss = rewriteCssUrls(css, pageUrl, urlMapping);
          return match.replace(css, rewrittenCss);
        }
      );

      // Debug: Check if rewriting worked for images
      const rewrittenLogoMatches = rewrittenHtml.match(/logo\.png/gi);
      const rewrittenAssetPaths = rewrittenHtml.match(/\.\/assets\/[^"'\s]+/g);
      console.log(`  → After rewriting:`);
      if (rewrittenLogoMatches) {
        console.log(
          `    - Still ${rewrittenLogoMatches.length} references to logo.png`
        );
      }
      if (rewrittenAssetPaths) {
        console.log(
          `    - ${rewrittenAssetPaths.length} references to local assets`
        );
        const imageAssets = rewrittenAssetPaths.filter((p) =>
          p.includes("/images/")
        );
        console.log(`    - ${imageAssets.length} are in images directory`);
      }

      // Add offline indicator banner
      const offlineBanner = `
        <div style="position: fixed; top: 0; left: 0; right: 0; background: #2196F3; color: white; 
                    padding: 10px; text-align: center; z-index: 999999; font-family: Arial, sans-serif;">
          📦 Cached Content - Viewing Offline Version
        </div>
        <div style="height: 40px;"></div>
      `;
      rewrittenHtml = rewrittenHtml.replace(
        /<body([^>]*)>/,
        `<body$1>${offlineBanner}`
      );

      // Save the HTML file
      let htmlFileName;
      if (pageUrl === normalizedUrl) {
        htmlFileName = "index.html";
      } else {
        const pageHash = crypto
          .createHash("md5")
          .update(pageUrl)
          .digest("hex")
          .substring(0, 12);
        htmlFileName = `page_${pageHash}.html`;
      }

      const htmlPath = path.join(
        pageUrl === normalizedUrl ? cacheDir : pagesDir,
        htmlFileName
      );
      await fs.writeFile(htmlPath, rewrittenHtml);

      // Verify the file was actually written
      try {
        const stats = await fs.stat(htmlPath);
        console.log(
          `  → Verified HTML saved: ${htmlFileName} (${stats.size} bytes)`
        );
      } catch (verifyErr) {
        console.error(`  ⚠ Failed to verify HTML file: ${verifyErr.message}`);
      }

      manifest.pages.push({
        url: pageUrl,
        local_path:
          pageUrl === normalizedUrl
            ? `./${htmlFileName}`
            : `./pages/${htmlFileName}`,
        depth: depth,
      });

      console.log(`✓ Successfully cached: ${pageUrl}`);
    } catch (err) {
      console.error(`✗ Failed to cache page ${pageUrl}: ${err.message}`);
      if (err.message.includes("timeout")) {
        console.error(`  Timeout error - site may be too slow or blocking`);
      }
      // Mark as failed but continue with other pages
      manifest.errors = manifest.errors || [];
      manifest.errors.push({
        url: pageUrl,
        error: err.message,
      });
    } finally {
      await page.close();
    }
  }

  // Check if we actually cached anything
  if (manifest.pages.length === 0) {
    await browser.close();
    throw new Error("Failed to cache any pages - no content was saved");
  }

  // Save manifest
  await fs.writeFile(
    path.join(cacheDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  await browser.close();

  return {
    success: manifest.pages.length > 0,
    cacheHash,
    url: normalizedUrl,
    manifest,
  };
}

// API Endpoints

// Cache a URL
app.post("/api/cache", async (req, res) => {
  try {
    const { url, maxDepth, cookies } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Starting cache process for: ${url}`);
    console.log(`Max depth: ${maxDepth || 0}`);
    console.log(`${"=".repeat(60)}\n`);
    const result = await cachePage(url, { maxDepth: maxDepth || 0, cookies });

    res.json({
      success: true,
      message: "Page cached successfully",
      cacheHash: result.cacheHash,
      url: result.url,
      stats: {
        pages: result.manifest.pages.length,
        assets: result.manifest.assets.length,
      },
    });
  } catch (error) {
    console.error("Caching error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Check if URL is cached
app.get("/api/check/:url", async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    const normalizedUrl = normalizeUrl(url);
    const cacheHash = generateHash(normalizedUrl);
    const cacheDir = path.join(CACHE_DIR, cacheHash);

    try {
      await fs.access(cacheDir);
      const manifestPath = path.join(cacheDir, "manifest.json");
      const manifestData = await fs.readFile(manifestPath, "utf8");
      const manifest = JSON.parse(manifestData);

      res.json({
        cached: true,
        cacheHash,
        manifest,
      });
    } catch (err) {
      res.json({
        cached: false,
        cacheHash,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Serve cached files
app.get("/cached/:hash/*", async (req, res) => {
  try {
    const { hash } = req.params;
    const filePath = req.params[0] || "index.html";
    const fullPath = path.join(CACHE_DIR, hash, filePath);

    // Security check - ensure path is within cache directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedCacheDir = path.resolve(CACHE_DIR, hash);

    if (!resolvedPath.startsWith(resolvedCacheDir)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        // If directory, try to serve index.html
        const indexPath = path.join(resolvedPath, "index.html");
        const data = await fs.readFile(indexPath);
        res.setHeader("Content-Type", "text/html");
        res.send(data);
      } else {
        const data = await fs.readFile(resolvedPath);
        const mimeType =
          mime.lookup(resolvedPath) || "application/octet-stream";
        res.setHeader("Content-Type", mimeType);
        res.send(data);
      }
    } catch (err) {
      res.status(404).json({ error: "File not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
ensureCacheDir().then(() => {
  app.listen(PORT, () => {
    console.log(
      `\n🚀 Dynamic Website Caching Server running on http://localhost:${PORT}`
    );
    console.log(`📦 Cache directory: ${CACHE_DIR}`);
    console.log(
      `🧪 Open http://localhost:${PORT}/test-page.html to start testing\n`
    );
  });
});
