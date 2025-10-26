# Testing Checklist for Hybrid Architecture

## Prerequisites

- [ ] Chrome browser installed
- [ ] Node.js and npm installed
- [ ] Extension loaded in Chrome (`chrome://extensions/`)
- [ ] `config.js` exists with valid API keys

## Test 1: Server Starts Successfully

### Steps:

1. Open terminal
2. Navigate to prototype folder: `cd prototype`
3. Run: `npm install` (first time only)
4. Run: `npm start`

### Expected Results:

- [ ] Server starts without errors
- [ ] Console shows: "🚀 Dynamic Website Caching Server running on http://localhost:3000"
- [ ] Console shows cache directory path
- [ ] No error messages

### Test Command:

```bash
curl http://localhost:3000/api/health
```

### Expected Response:

```json
{
	"status": "ok",
	"version": "1.0.0",
	"timestamp": "2025-10-26T..."
}
```

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 2: Server API Endpoints Work

### Test Health Endpoint:

```bash
curl http://localhost:3000/api/health
```

- [ ] Returns 200 OK
- [ ] Returns JSON with status, version, timestamp

### Test Cache Endpoint:

```bash
curl -X POST http://localhost:3000/api/cache \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxDepth":0}'
```

- [ ] Returns 200 OK
- [ ] Returns JSON with success, cacheHash, url, stats
- [ ] Creates cache directory in `prototype/cache/`
- [ ] Terminal shows caching progress

### Test Content Endpoint:

```bash
# Use cacheHash from previous test
curl http://localhost:3000/api/content/<HASH>
```

- [ ] Returns 200 OK
- [ ] Returns JSON with success, content, manifest, url
- [ ] Content field contains HTML

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 3: Extension Works Without Server (Simple Caching)

### Setup:

1. Ensure server is NOT running (stop with Ctrl+C if running)
2. Edit `config.js`: Set `PLAYWRIGHT_ENABLED: false`
3. Reload extension in Chrome

### Steps:

1. Open extension popup
2. Navigate to `https://example.com`
3. Click "Cache This Page"

### Expected Results:

- [ ] No server status indicator shown (hidden)
- [ ] Button shows "Caching..." while processing
- [ ] Alert shows "Page cached successfully! (📄 Simple caching)"
- [ ] Page appears in cached pages list
- [ ] Clicking "View" opens cached page
- [ ] Background console shows "📄 Using simple scraping..."

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 4: Extension Detects Server Availability

### Setup:

1. Edit `config.js`: Set `PLAYWRIGHT_ENABLED: true`
2. Ensure server is running: `cd prototype && npm start`
3. Reload extension in Chrome

### Steps:

1. Open extension popup
2. Look for server status indicator

### Expected Results:

- [ ] Server status indicator is visible
- [ ] Shows green dot (●) with "Advanced caching available"
- [ ] Status checks within 3 seconds

### Test Server Offline:

1. Stop server (Ctrl+C)
2. Wait 5 seconds
3. Close and reopen extension popup

### Expected Results:

- [ ] Server status indicator is visible
- [ ] Shows red dot (●) with "Using simple caching"

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 5: Extension Works With Server (Advanced Caching)

### Setup:

1. Ensure server is running
2. Edit `config.js`: Set `PLAYWRIGHT_ENABLED: true`
3. Reload extension in Chrome

### Steps:

1. Navigate to `https://example.com`
2. Open extension popup
3. Verify green status indicator
4. Click "Cache This Page"

### Expected Results:

- [ ] Button shows "Caching..." while processing
- [ ] Alert shows "Page cached successfully! (🎭 Advanced caching)"
- [ ] Page appears in cached pages list
- [ ] Background console shows "🎭 Attempting to cache with Playwright"
- [ ] Background console shows "✅ Playwright cache successful"
- [ ] Server terminal shows caching progress
- [ ] Cached page includes images and assets

### Test with Complex Site:

1. Navigate to `https://github.com`
2. Click "Cache This Page"
3. Wait for completion (may take 30-60 seconds)

### Expected Results:

- [ ] Caching completes successfully
- [ ] Alert shows advanced caching method
- [ ] Cached page looks complete with styling

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 6: Fallback Behavior Works

### Setup:

1. Server is running
2. `PLAYWRIGHT_ENABLED: true`
3. Extension loaded

### Steps:

1. Open extension popup (should show green status)
2. Navigate to `https://example.com`
3. Click "Cache This Page"
4. While caching, stop the server (Ctrl+C in server terminal)

### Alternative Test (Easier):

1. Edit server.js temporarily to make cache endpoint return error
2. Try caching a page

### Expected Results:

- [ ] Caching doesn't fail completely
- [ ] Background console shows "⚠️ Playwright failed, falling back to simple scraping"
- [ ] Alert shows "Page cached successfully! (📄 Simple caching)"
- [ ] Page is cached using simple method

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 7: CORS Headers Work

### Steps:

1. Open extension popup
2. Open DevTools on popup (right-click popup → Inspect)
3. Go to Console tab
4. Try caching a page

### Expected Results:

- [ ] No CORS errors in console
- [ ] Fetch requests to localhost:3000 succeed
- [ ] No "Access-Control-Allow-Origin" errors

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 8: Configuration Changes Reflected

### Test 1: Disable Playwright

1. Edit `config.js`: `PLAYWRIGHT_ENABLED: false`
2. Reload extension
3. Open popup

**Expected:**

- [ ] Server status indicator hidden
- [ ] Simple caching used

### Test 2: Change Server URL

1. Edit `config.js`: `PLAYWRIGHT_SERVER_URL: "http://localhost:9999"`
2. Reload extension
3. Open popup

**Expected:**

- [ ] Server status shows red/offline (server not on port 9999)

### Test 3: Change Timeout

1. Edit `config.js`: `PLAYWRIGHT_TIMEOUT: 5000` (5 seconds)
2. Try caching a slow site
3. Should timeout faster

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 9: Error Handling

### Test Server Connection Timeout:

1. Edit server.js: Add `await sleep(10000)` at start of cache endpoint
2. Try caching with 3-second timeout
3. Should fall back to simple caching

### Test Invalid URL:

1. Try caching `chrome://extensions/`
2. Should show "Cannot cache this page (restricted URL)"

### Test Network Error:

1. Disconnect internet
2. Try simple caching
3. Should show appropriate error

**Status:** ⬜ Pass / ⬜ Fail

---

## Test 10: Integration Test (Full Workflow)

### Scenario: User switches between modes

1. **Start with simple caching:**

   - Set `PLAYWRIGHT_ENABLED: false`
   - Cache 2-3 pages
   - Verify they work

2. **Enable Playwright:**

   - Start server
   - Set `PLAYWRIGHT_ENABLED: true`
   - Reload extension
   - Cache 2-3 different pages
   - Verify they use advanced caching

3. **Server goes down:**

   - Stop server
   - Try caching another page
   - Should fall back automatically

4. **Restart server:**
   - Start server again
   - Open popup
   - Should show green status again

**Expected:**

- [ ] All cached pages viewable
- [ ] Method indicators correct
- [ ] No data loss between switches
- [ ] UI updates appropriately

**Status:** ⬜ Pass / ⬜ Fail

---

## Summary

### Pass/Fail Count:

- Total Tests: 10
- Passed: \_\_\_
- Failed: \_\_\_
- Pass Rate: \_\_\_%

### Critical Issues Found:

1.
2.
3.

### Minor Issues Found:

1.
2.
3.

### Recommendations:

1.
2.
3.

---

## Performance Benchmarks

| Site          | Simple Caching | Advanced Caching | Size (Simple) | Size (Advanced) |
| ------------- | -------------- | ---------------- | ------------- | --------------- |
| example.com   | \_\_\_ sec     | \_\_\_ sec       | \_\_\_ KB     | \_\_\_ MB       |
| github.com    | \_\_\_ sec     | \_\_\_ sec       | \_\_\_ KB     | \_\_\_ MB       |
| wikipedia.org | \_\_\_ sec     | \_\_\_ sec       | \_\_\_ KB     | \_\_\_ MB       |

---

## Browser Console Logs to Check

### Background Script Console:

- [ ] "✅ Playwright server is available"
- [ ] "🎭 Attempting to cache with Playwright"
- [ ] "✅ Playwright cache successful"
- [ ] "⚠️ Playwright server not available"
- [ ] "📄 Using simple scraping"

### Server Terminal:

- [ ] "Starting cache process for: ..."
- [ ] "Playwright caching complete"
- [ ] No unhandled errors

### Popup Console:

- [ ] No CORS errors
- [ ] Configuration loaded successfully
- [ ] Server status checks working

---

## Deployment Checklist

Before considering complete:

- [ ] All tests pass
- [ ] No console errors
- [ ] Documentation complete
- [ ] Example config files updated
- [ ] CORS headers working
- [ ] Fallback behavior verified
- [ ] Error messages user-friendly
- [ ] Performance acceptable
- [ ] Code commented appropriately
- [ ] Git commits made

---

## Next Steps

After passing all tests:

1. Create example videos/screenshots
2. Update user documentation
3. Add troubleshooting guide
4. Consider adding metrics/analytics
5. Plan for future enhancements
