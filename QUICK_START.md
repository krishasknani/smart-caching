# 🚀 Quick Start Guide - Hybrid Caching

## Choose Your Mode

### Mode 1: Simple Caching (Zero Setup) ⚡

**Best for:** Quick testing, basic websites, no dependencies

1. Open Chrome extension popup
2. Navigate to any website
3. Click "Cache This Page"
4. Done! ✅

**Speed:** 2-5 seconds  
**Pros:** No setup, fast  
**Cons:** May miss JavaScript content

---

### Mode 2: Advanced Caching (With Server) 🎭

**Best for:** SPAs, JavaScript-heavy sites, complete asset capture

#### Step 1: Start Server (One Time)

```bash
cd prototype
npm install          # First time only
npm start           # Keep this running
```

#### Step 2: Enable in Extension

1. Edit `config.js`:
   ```javascript
   PLAYWRIGHT_ENABLED: true;
   ```
2. Go to `chrome://extensions/`
3. Click refresh icon on Smart Caching extension

#### Step 3: Use It

1. Open extension popup
2. Look for 🟢 "Advanced caching available"
3. Navigate to any website
4. Click "Cache This Page"
5. Wait for completion (10-60 seconds)
6. See: "Page cached successfully! (🎭 Advanced caching)"

---

## Troubleshooting

### Server won't start?

```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill the process
kill -9 <PID>

# Try again
npm start
```

### Extension shows red dot?

1. Make sure server is running: `curl http://localhost:3000/api/health`
2. Check `PLAYWRIGHT_ENABLED: true` in config.js
3. Reload extension

### Caching fails?

1. Check terminal where server is running for errors
2. Some sites block automation (will automatically fallback)
3. Try a simpler site first (example.com)

---

## Test Your Setup

### Quick Test

```bash
cd prototype
./test-server.sh
```

### Manual Test

1. Start server
2. Open extension popup
3. Check for green status indicator
4. Visit https://example.com
5. Click "Cache This Page"
6. Should complete in ~10-30 seconds

---

## Files You Need to Know

- `config.js` - Settings (edit this)
- `prototype/server.js` - Playwright server (run this)
- `PLAYWRIGHT_SETUP.md` - Detailed guide
- `TESTING_CHECKLIST.md` - Full test suite

---

## Common Workflows

### Daily Usage (Server Mode)

```bash
# Terminal 1: Start server once
cd prototype && npm start

# Use extension normally
# Server stays running all day
# Ctrl+C to stop when done
```

### Switch to Simple Mode

1. Edit `config.js`: `PLAYWRIGHT_ENABLED: false`
2. Reload extension
3. Server not needed anymore

### Back to Advanced Mode

1. Start server: `cd prototype && npm start`
2. Edit `config.js`: `PLAYWRIGHT_ENABLED: true`
3. Reload extension

---

## What to Expect

### Simple Caching Shows:

- 📄 "Page cached successfully! (📄 Simple caching)"
- No server status indicator
- Fast completion

### Advanced Caching Shows:

- 🟢 Green status indicator before caching
- 🎭 "Page cached successfully! (🎭 Advanced caching)"
- Longer wait time
- Server terminal shows progress

---

## Need Help?

1. **Setup issues**: See `PLAYWRIGHT_SETUP.md`
2. **Testing**: See `TESTING_CHECKLIST.md`
3. **Bot protection**: See `prototype/BOT_PROTECTION_INFO.md`
4. **Implementation**: See `IMPLEMENTATION_SUMMARY.md`

---

## Success Indicators

✅ Server running: `curl http://localhost:3000/api/health` returns JSON  
✅ Extension loaded: Visible in `chrome://extensions/`  
✅ Status indicator: Shows green dot in popup  
✅ Caching works: Alert shows which method was used  
✅ Viewing works: Cached pages open in new tab

---

## Pro Tips

1. **For speed**: Use simple caching for news/blogs
2. **For completeness**: Use advanced for SPAs/interactive sites
3. **For reliability**: Leave simple as fallback (don't force advanced)
4. **For testing**: Start simple, then try advanced
5. **For debugging**: Check browser console and server terminal

---

## Example Sites to Test

### Simple Caching (Try First)

- https://example.com
- https://info.cern.ch
- https://motherfuckingwebsite.com

### Advanced Caching (Try After)

- https://github.com
- https://developer.mozilla.org
- https://reactjs.org

### Known Issues

- ❌ claude.ai (Cloudflare protection)
- ❌ stackoverflow.com (Bot detection)

---

## That's It! 🎉

You now have a hybrid caching system that:

- Works without setup (simple mode)
- Enhanced with server (advanced mode)
- Automatically falls back on errors
- Shows you which method is used

Start with simple mode, try advanced mode when needed!
