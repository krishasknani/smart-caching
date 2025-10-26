# Playwright Server Setup Guide

## Quick Start

1. Open a terminal in the `prototype` folder
2. Run: `npm install` (first time only)
3. Run: `npm start`
4. Keep this terminal open while using the extension

## Configuration

Edit `config.js` in the extension root:

```javascript
PLAYWRIGHT_ENABLED: true, // Enable Playwright caching
PLAYWRIGHT_SERVER_URL: "http://localhost:3000", // Server URL
PLAYWRIGHT_TIMEOUT: 60000, // 60 seconds timeout
```

After editing, reload the extension in Chrome:

1. Go to `chrome://extensions/`
2. Click the refresh icon on the Smart Caching extension

## How It Works

### Architecture

The system uses a hybrid architecture:

1. **Playwright Server** (Optional, runs separately)

   - Node.js/Express server with Playwright
   - Handles advanced caching with full browser rendering
   - Located in `prototype/` folder
   - Runs on `http://localhost:3000`

2. **Chrome Extension** (Always active)
   - Communicates with server via HTTP when available
   - Falls back to simple scraping when server is offline
   - Stores all cached content in Chrome storage

### Caching Methods

**Simple Caching (Default):**

- Fast (~2-5 seconds)
- Uses `fetch()` API to download HTML
- Works for basic websites
- No external dependencies needed

**Advanced Caching (With Playwright Server):**

- Slower (~10-60 seconds)
- Full Chrome browser rendering
- Captures JavaScript-generated content
- Downloads all assets (images, CSS, JS, fonts)
- Works with SPAs and dynamic sites

### When Each Method is Used

The extension automatically chooses the best method:

```
User clicks "Cache This Page"
         ↓
Is PLAYWRIGHT_ENABLED = true?
         ↓
    Yes → Check server health
         ↓
Server online? → Use Playwright ✅
         ↓
Server offline? → Use simple caching 📄
         ↓
PLAYWRIGHT_ENABLED = false? → Use simple caching 📄
```

## Server Commands

### Start Server

```bash
cd prototype
npm start
```

### Check Server Status

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
	"status": "ok",
	"version": "1.0.0",
	"timestamp": "2025-10-26T..."
}
```

### Test Caching via Server

```bash
curl -X POST http://localhost:3000/api/cache \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxDepth":0}'
```

## Troubleshooting

### Server won't start

**Error: Port 3000 already in use**

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process (replace <PID> with actual process ID)
kill -9 <PID>
```

**Error: Module not found**

```bash
# Reinstall dependencies
cd prototype
rm -rf node_modules package-lock.json
npm install
```

**Error: Playwright browser not found**

```bash
# Reinstall Playwright browsers
npx playwright install chromium
```

### Extension can't connect

**Check server is running:**

```bash
curl http://localhost:3000/api/health
```

**Check CORS errors:**

- Open extension popup
- Right-click → Inspect
- Check Console for errors
- Look for "CORS" or "Failed to fetch"

**Verify configuration:**

- Open `config.js`
- Ensure `PLAYWRIGHT_SERVER_URL: "http://localhost:3000"`
- Ensure `PLAYWRIGHT_ENABLED: true`
- Reload extension after changes

### Caching fails

**Server logs show errors:**

- Check terminal where server is running
- Look for error messages
- Some sites block automated browsers

**Timeout errors:**

- Increase timeout in `config.js`:
  ```javascript
  PLAYWRIGHT_TIMEOUT: 120000, // 2 minutes
  ```

**Bot protection detected:**

- Some sites (Claude.com, Stack Overflow) block Playwright
- Fallback to simple caching will happen automatically
- See `prototype/BOT_PROTECTION_INFO.md` for details

### Status indicator not showing

**If status indicator doesn't appear:**

- Check that `PLAYWRIGHT_ENABLED: true` in `config.js`
- Reload extension
- Open popup again

**Status shows offline but server is running:**

- Check server URL in config matches actual server
- Check firewall isn't blocking localhost connections
- Try accessing `http://localhost:3000/api/health` in browser

## Performance Tips

### Simple Caching

- **Speed**: 2-5 seconds per page
- **Best for**: News articles, blogs, documentation
- **Limitations**: May miss JavaScript-generated content

### Advanced Caching

- **Speed**: 10-60 seconds per page
- **Best for**: SPAs, interactive sites, image-heavy pages
- **Limitations**: Slower, requires server running

### Recommendations

| Site Type       | Recommended Method              |
| --------------- | ------------------------------- |
| Static HTML     | Simple (faster)                 |
| News/Blogs      | Simple (faster)                 |
| Wikipedia       | Simple (faster)                 |
| GitHub          | Advanced (better rendering)     |
| Twitter/X       | Advanced (dynamic content)      |
| React/Vue apps  | Advanced (JavaScript rendering) |
| Image galleries | Advanced (captures all images)  |

## Development

### Server API Endpoints

**GET /api/health**

- Check server status
- Returns: `{status: "ok", version: "1.0.0", timestamp: "..."}`

**POST /api/cache**

- Cache a URL
- Body: `{url: "https://...", maxDepth: 0}`
- Returns: `{success: true, cacheHash: "...", stats: {...}}`

**GET /api/check/:url**

- Check if URL is cached
- Returns: `{cached: true/false, cacheHash: "...", manifest: {...}}`

**GET /api/content/:hash**

- Get cached content by hash
- Returns: `{success: true, content: "...", manifest: {...}, url: "..."}`

**GET /cached/:hash/\***

- Serve cached files
- Returns: HTML, CSS, JS, images, etc.

### Extension Messages

**Background script handles:**

```javascript
chrome.runtime.sendMessage({
	action: "getPageContent",
	url: "https://example.com",
	maxDepth: 0,
	forceSimple: false,
});
```

**Response:**

```javascript
{
  success: true,
  method: "playwright" | "simple",
  stats: { pages: 1, assets: 25 }
}
```

## Testing Checklist

- [ ] Server starts without errors
- [ ] Health endpoint returns OK
- [ ] Extension shows green status when server is running
- [ ] Caching a simple page works (e.g., example.com)
- [ ] Server logs show successful cache
- [ ] Cached page displays in extension
- [ ] Stop server
- [ ] Extension shows red status (using simple caching)
- [ ] Caching still works (fallback mode)
- [ ] Cached page displays in extension

## Best Sites to Test

### Works Great with Playwright

- ✅ https://github.com
- ✅ https://live.calhacks.io
- ✅ https://developer.mozilla.org
- ✅ https://reactjs.org

### Works with Simple Caching

- ✅ https://example.com
- ✅ https://news.ycombinator.com
- ✅ https://en.wikipedia.org

### Known Issues

- ❌ https://claude.ai (Cloudflare protection)
- ❌ https://stackoverflow.com (Bot detection)
- ⚠️ https://twitter.com (Requires auth)

## FAQ

**Q: Do I need to run the server?**
A: No, the extension works fine without it using simple caching. The server is optional for advanced features.

**Q: Can I run the server on a different port?**
A: Yes, edit `prototype/server.js` and change `PORT = 3000`, then update `PLAYWRIGHT_SERVER_URL` in `config.js`.

**Q: Does the server need to stay running?**
A: Only when you want to use advanced caching. You can start/stop it anytime.

**Q: Can I use this on multiple computers?**
A: Yes, but you need to run the server separately on each computer, or configure one as a server and point others to it.

**Q: How much disk space does caching use?**
A: Simple caching: ~100KB-1MB per page. Advanced caching: ~1MB-10MB per page (includes all assets).

**Q: Where are cached files stored?**
A: Extension storage: Chrome storage API. Server storage: `prototype/cache/` folder.

## Support

For issues related to:

- **Extension**: Check browser console and extension errors
- **Server**: Check terminal logs where server is running
- **Specific sites**: See `prototype/BOT_PROTECTION_INFO.md`

## License

This project is for educational and development purposes.
