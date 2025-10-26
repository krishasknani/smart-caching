# Troubleshooting Dynamic Website Caching

## Common Issues and Solutions

### Issue: Frozen Countdown / Real-time Updates Don't Work

**This is expected behavior!** ✅

When you cache a page, you're saving a snapshot at a specific moment in time. Any JavaScript that:

- Updates in real-time (countdowns, clocks, live data)
- Makes API calls to get new data
- Requires an internet connection

Will be frozen at the moment you cached it. This is a fundamental limitation of offline caching.

**What DOES work:**

- All static content (text, images, styling)
- Interactive buttons and navigation (if they're client-side)
- Pre-loaded JavaScript functionality
- Cached pages and assets

### Issue: Buttons Don't Work / Page Not Interactive

**Common causes:**

1. **Client-side routing (SPAs)**: Modern single-page apps like React/Vue/Angular use client-side routing. When you click a link, it tries to load new data via JavaScript, which may fail offline.

2. **API calls**: If buttons trigger API requests, they'll fail offline unless we cached those specific API responses.

3. **CSP (Content Security Policy)**: Some sites have strict security policies that block locally served content.

**Solutions:**

- For SPAs, make sure to cache with `maxDepth > 0` to cache linked pages
- Test with simpler, server-rendered sites first
- Some sites just won't work perfectly offline - that's okay!

### Issue: Missing Content / Incomplete Rendering

**Solutions:**

1. **Increase wait time** - The caching process now waits 3 seconds after network idle and scrolls the page to trigger lazy loading. For very slow sites, you might need to increase this further.

2. **Check console logs** - The server now provides detailed logging. Look for warnings about failed resources.

3. **Try caching again** - Sometimes resources fail to load due to network issues. Try caching the same site again.

### Issue: Caching Takes Too Long / Never Completes

**Common causes:**

1. **Too many linked pages** - If `maxDepth > 0`, the caching process tries to cache all linked pages recursively.

2. **Large site with many assets** - Sites with hundreds of images/videos will take time.

3. **Slow site** - Some sites are just slow to load.

**Solutions:**

1. **Set maxDepth to 0** (default now) - This caches only the current page, not linked pages.

   ```
   maxDepth: 0  → Only current page (fast)
   maxDepth: 1  → Current + direct links (medium)
   maxDepth: 2+ → Many pages (slow!)
   ```

2. **Check server logs** - The terminal shows progress. Look for which URL is taking long.

3. **Increase timeout** - Edit `server.js` line 282:

   ```javascript
   timeout: 120000,  // 2 minutes instead of 1
   ```

4. **Cancel and try a simpler page** - Kill the server (Ctrl+C) and try a less complex site first.

## Best Practices for Testing

### Start Simple, Go Complex

1. **Static HTML sites** (work perfectly):

   - https://example.com
   - https://info.cern.ch
   - Simple blogs

2. **Server-rendered sites** (work well):

   - https://news.ycombinator.com
   - https://old.reddit.com
   - Most news sites

3. **Modern SPAs** (work partially):
   - https://live.calhacks.io
   - Complex web apps
   - May have frozen dynamic features

### Recommended Settings

- **Simple static sites**: `maxDepth: 0-1`
- **News/article sites**: `maxDepth: 1-2`
- **Complex web apps**: `maxDepth: 0` (current page only)

## Site-Specific Tips

### Cal Hacks Live Site (https://live.calhacks.io/)

**What works:**

- ✅ Full layout and styling
- ✅ All visible content
- ✅ Images and design elements
- ✅ Tab navigation (if cached with proper links)

**What doesn't work:**

- ❌ Real-time countdown (frozen at cache time)
- ❌ Live updates to schedule
- ❌ Dynamic data loading

**Recommendation**: Cache with `maxDepth: 0` for best results. The countdown being frozen is expected - you're viewing a snapshot.

### YC Events / Complex Sites

**Why it takes long:**

- Many linked pages at different depths
- Lots of images and resources
- Complex JavaScript bundles

**Solution:**

- Always use `maxDepth: 0` for complex sites
- Only cache specific pages you need
- Consider caching multiple separate pages instead of using depth

## Understanding Limitations

### What Can Be Cached Perfectly ✅

- HTML content
- CSS styling
- JavaScript files
- Images, fonts, icons
- Static JSON data
- Pre-rendered content

### What Has Limitations ⚠️

- Real-time updates (countdowns, live data)
- API-dependent features
- Authentication-required content
- WebSockets / live connections
- Video streaming
- Form submissions

### What Won't Work Offline ❌

- Live data feeds
- New API requests
- User authentication (unless cached while logged in)
- Third-party embeds requiring internet
- Payment processing
- Real-time chat/collaboration

## Debugging Tips

1. **Check server logs** - The terminal shows detailed progress and errors

2. **Inspect cached files**:

   ```bash
   ls -la prototype/cache/
   ```

3. **View manifest**:

   ```bash
   cat prototype/cache/<hash>/manifest.json | jq
   ```

4. **Check browser console** - Open DevTools when viewing cached page to see JavaScript errors

5. **Compare online vs cached** - Open the original site and cached version side-by-side

## Performance Tips

- **Clear old cache regularly** to save disk space
- **Cache during good internet connection** for faster downloads
- **Test with small sites first** before trying large ones
- **Use maxDepth wisely** - each level multiplies the number of pages

## When to Report a Bug

Report if you see:

- ✅ Assets that should load but don't (404 errors)
- ✅ Completely broken layout (CSS not applied)
- ✅ Server crashes or hangs indefinitely
- ✅ Error messages that don't make sense

Don't report:

- ❌ Frozen countdowns/timers (expected)
- ❌ Non-working API calls (expected)
- ❌ Real-time features not updating (expected)
- ❌ Sites that are slow to cache (use maxDepth: 0)
