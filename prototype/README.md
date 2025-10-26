# Dynamic Website Caching MVP Prototype

A standalone prototype that demonstrates full-featured website caching with JavaScript rendering support using Playwright.

## Features

- ✅ **Full JavaScript Rendering** - Uses Playwright headless Chrome to fully render JS-heavy sites
- ✅ **Complete Asset Download** - Captures HTML, CSS, JS, images, fonts, JSON responses
- ✅ **URL Rewriting** - Converts absolute URLs to relative paths for offline access
- ✅ **Linked Page Caching** - Automatically caches same-origin linked pages (configurable depth)
- ✅ **Offline Viewing** - Serves cached content locally without internet
- ✅ **Authentication Support** - Can cache pages requiring login (with cookies)
- ✅ **Bot Protection Detection** - Identifies sites with anti-bot measures

## Quick Start

### 1. Install Dependencies

```bash
cd prototype
npm install
```

This will install:

- `express` - Web server
- `playwright` - Headless browser automation
- `mime-types` - Content type detection

Playwright will also download its browser binaries (~200MB).

### 2. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

### 3. Open Test Page

Open your browser and go to:

```
http://localhost:3000/test-page.html
```

### 4. Cache a Website

1. Enter a URL (e.g., `https://example.com` or `https://news.ycombinator.com`)
2. Click **"Cache This Site"**
3. Wait for the caching process to complete (10-60 seconds depending on site size)
4. Click **"View Cached"** to open the offline version

### 5. Test Offline

1. After caching a site, disconnect your WiFi/internet
2. Click **"View Cached"** again
3. The site loads perfectly from the local cache!

## Architecture

### Server Components

**`server.js`** - Main caching engine with three key endpoints:

- `POST /api/cache` - Cache a website

  - Launches Playwright browser
  - Intercepts all network requests
  - Saves assets locally with organized structure
  - Rewrites URLs to relative paths
  - Caches linked pages (up to configurable depth)

- `GET /api/check/:url` - Check if URL is cached

  - Returns cache status and metadata

- `GET /cached/:hash/*` - Serve cached files
  - Serves HTML, CSS, JS, images, etc. from local cache
  - Sets proper MIME types

### Caching Process

1. **Launch Browser** - Playwright opens headless Chrome
2. **Navigate** - Goes to target URL with `waitUntil: 'networkidle'`
3. **Intercept** - Captures all HTTP requests/responses
4. **Save Assets** - Downloads and stores locally in organized folders
5. **Rewrite URLs** - Converts absolute URLs to relative paths in HTML/CSS
6. **Cache Links** - Finds same-origin links and recursively caches them
7. **Generate Manifest** - Creates metadata file with cache info

### Cache Structure

```
cache/
  <url-hash>/
    index.html              # Main page (rewritten URLs)
    manifest.json           # Cache metadata
    assets/
      styles/               # CSS files
        abc123.css
      scripts/              # JavaScript files
        def456.js
      images/               # Images
        ghi789.png
      fonts/                # Fonts
        jkl012.woff2
      data/                 # JSON responses
      misc/                 # Other assets
    pages/                  # Linked pages
      page_xyz.html
```

## Advanced Features

### Authentication Support

To cache pages requiring login:

1. Log in to the site in Chrome
2. Open DevTools → Application → Cookies
3. Export cookies as JSON array
4. Pass to cache endpoint:

```javascript
fetch("/api/cache", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://mail.google.com",
    cookies: [{ name: "session", value: "abc123", domain: ".google.com" }],
  }),
});
```

### Configurable Link Depth

Control how many levels of links to cache:

```javascript
{
  url: 'https://example.com',
  maxDepth: 2  // 0 = current page only, 1 = current + direct links, etc.
}
```

Default is 2 levels (main page + direct links + their links).

## Testing Recommendations

### Good Test Sites

1. **Static Sites**

   - `https://example.com` - Very simple
   - `https://motherfuckingwebsite.com` - Minimal HTML

2. **JS-Heavy Sites**

   - `https://news.ycombinator.com` - React-based
   - `https://old.reddit.com` - Dynamic content
   - `https://www.wikipedia.org` - Complex layout

3. **Image-Heavy Sites**
   - `https://unsplash.com` - High-res images
   - News sites with photos

### What Works Well

- Static HTML sites
- React/Vue/Angular single-page apps
- Sites with CSS/JS/images/fonts
- Most public content sites
- Authenticated pages (with cookies)

### Known Limitations

- Dynamic forms/POST requests won't work offline
- Real-time features (chat, live updates) won't function
- Some sites with strict CSP may have issues
- Very large sites (1000+ pages) should use lower maxDepth
- Video streaming won't work (files too large)

## API Reference

### POST /api/cache

Cache a website with all assets.

**Request:**

```json
{
  "url": "https://example.com",
  "maxDepth": 2,
  "cookies": [] // optional - authentication cookies
}
```

**Response:**

```json
{
  "success": true,
  "cacheHash": "abc123...",
  "url": "https://example.com",
  "stats": {
    "pages": 5,
    "assets": 42
  }
}
```

### GET /api/check/:url

Check if URL is cached.

**Response:**

```json
{
  "cached": true,
  "cacheHash": "abc123...",
  "manifest": {
    "url": "https://example.com",
    "cached_at": "2025-10-26T10:30:00Z",
    "pages": [...],
    "assets": [...]
  }
}
```

### GET /cached/:hash/\*

Serve cached file.

Example: `/cached/abc123/index.html`

## Troubleshooting

### "Module not found" errors

Run `npm install` to install dependencies.

### Caching takes forever

Some sites are large. Try:

- Reducing `maxDepth` to 0 or 1
- Testing with simpler sites first

### Cached page looks broken

Some sites use:

- CSP (Content Security Policy) that blocks local resources
- Absolute URLs in inline styles/scripts
- WebSockets or real-time features

These are edge cases that may need additional URL rewriting logic.

### Port 3000 already in use

Change the port in `server.js`:

```javascript
const PORT = 3001; // or any available port
```

## Next Steps

This prototype proves the concept works. To integrate into the Chrome extension:

1. **Backend Integration**

   - Run this Node server separately
   - Extension communicates via HTTP to localhost:3000
   - Or bundle with Electron for standalone app

2. **Smart Prediction Layer**

   - Analyze browsing history
   - Predict likely next sites
   - Auto-cache in background

3. **Cache Management**

   - Add UI to view all cached sites
   - Implement LRU eviction
   - Storage limit management

4. **Improved URL Rewriting**
   - Handle more edge cases
   - Support for SPAs with client-side routing
   - Better CSS @import handling

## License

MIT
