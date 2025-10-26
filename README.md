# Smart Caching Chrome Extension

A Chrome extension that allows users to manually cache web pages for offline viewing. This is the MVP version with basic caching functionality.

## Features

- **Manual Caching**: Click "Cache This Page" to save the current webpage
- **Offline Viewing**: View cached pages even when offline
- **Page Management**: View and delete cached pages from the popup
- **Clean Content**: Automatically removes scripts and event handlers for safe offline viewing

## Installation

### For Development

1. **Load the Extension in Chrome**:

   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `Smart Caching` folder

2. **Test the Extension**:
   - Visit any webpage
   - Click the extension icon in the toolbar
   - Click "Cache This Page" to cache the current page
   - View cached pages in the popup

### File Structure

```
Smart Caching/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup UI
├── popup.js              # Popup functionality
├── content.js            # Content script for page extraction
├── background.js         # Background service worker
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

1. **Content Extraction**: The content script (`content.js`) extracts the HTML content of the current page
2. **Content Cleaning**: Removes scripts, event handlers, and other potentially unsafe elements
3. **Storage**: Saves the cleaned content using Chrome's storage API
4. **Offline Viewing**: Cached pages can be viewed in new tabs using data URLs

## Usage

1. **Cache a Page**:

   - Navigate to any webpage you want to cache
   - Click the extension icon
   - Click "Cache This Page"
   - The page will be saved and available offline

2. **View Cached Pages**:

   - Click the extension icon
   - Scroll down to see your cached pages
   - Click "View" to open a cached page in a new tab
   - Click "Delete" to remove a cached page

3. **Offline Access**:
   - Cached pages work even when you're offline
   - They open in new tabs with a blue banner indicating they're cached content

## Technical Details

### Permissions Used

- `storage`: To save and retrieve cached pages
- `tabs`: To get information about the current tab
- `activeTab`: To interact with the current page

### Storage

- Uses Chrome's `chrome.storage.local` API
- Stores page data including URL, title, content, and timestamp
- Data persists between browser sessions

### Content Processing

- Removes all `<script>` tags for security
- Removes event handler attributes (`onclick`, `onload`, etc.)
- Adds a visual indicator that content is cached
- Preserves the original page structure and styling

## Development

### Making Changes

1. Edit the relevant files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes

### Debugging

- Use Chrome DevTools to debug popup and content scripts
- Check the console for any errors
- Use `chrome://extensions/` to see extension errors

## Advanced Caching (Optional)

For better caching of JavaScript-heavy websites, you can optionally run a local Playwright server:

### Setup

1. **Navigate to the prototype folder:**

   ```bash
   cd prototype
   npm install
   ```

2. **Start the server:**

   ```bash
   npm start
   ```

3. **Enable in extension:**
   - Edit `config.js` and set `PLAYWRIGHT_ENABLED: true`
   - Reload the extension

### Benefits

- ✅ Full JavaScript rendering
- ✅ Complete asset downloading (images, fonts, etc.)
- ✅ Better support for SPA frameworks (React, Vue, etc.)
- ✅ Captures lazy-loaded content

### Fallback

The extension automatically falls back to simple caching if:

- The server is not running
- `PLAYWRIGHT_ENABLED` is `false`
- The server request times out

### Status Indicator

When Playwright server is enabled in `config.js`, the extension popup will show:

- 🟢 **"Advanced caching available"** - Server is running
- 🔴 **"Using simple caching"** - Server is offline (uses fallback)

For detailed setup instructions, see [PLAYWRIGHT_SETUP.md](PLAYWRIGHT_SETUP.md).

## Future Enhancements

This MVP provides the foundation for more advanced features:

- **Automatic Caching**: Based on user behavior patterns
- **Email Integration**: Analyze emails to predict relevant content
- **Calendar Integration**: Cache content based on upcoming events
- **Smart Recommendations**: ML-based content suggestions
- **Cross-device Sync**: Share cached content across devices
- **Advanced Storage**: Better organization and search capabilities

## Troubleshooting

### Extension Not Loading

- Make sure all files are in the correct directory
- Check that `manifest.json` is valid JSON
- Ensure all referenced files exist

### Caching Not Working

- Check browser console for errors
- Make sure the content script is injected (check `chrome://extensions/`)
- Verify storage permissions are granted

### Pages Not Displaying

- Some pages may have CORS restrictions
- Complex JavaScript-heavy pages may not work perfectly offline
- Try caching simpler, static pages first

## License

This project is for educational and development purposes.
