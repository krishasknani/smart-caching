// Example configuration file for Cache-22 Extension
// Copy this file to config.js and add your actual API key

const CONFIG = {
	// Claude API Configuration
	CLAUDE_API_KEY: "your-claude-api-key-here",

	// Bright Data SERP API (used for smart caching discovery)
	// Get credentials at https://brightdata.com/
	BRIGHTDATA_TOKEN: "your-brightdata-token-here",
	BRIGHTDATA_ZONE: "your-brightdata-zone-here",
	// Optional: how many results to fetch per query
	SERP_RESULTS_PER_QUERY: 5,

	// Playwright Server Configuration (Optional)
	// Set PLAYWRIGHT_ENABLED to true and run the server for advanced caching
	PLAYWRIGHT_SERVER_URL: "http://localhost:3000",
	PLAYWRIGHT_ENABLED: false,
	PLAYWRIGHT_TIMEOUT: 60000,

	// API Settings
	CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
	CLAUDE_MODEL: "claude-3-5-sonnet-20241022",

	// Cache Settings
	CACHE_DURATION_HOURS: 24,

	// Analysis Settings
	MAX_HISTORY_ITEMS: 100000,
	MAX_TABS_ITEMS: 1000,
};

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
} else if (typeof window !== "undefined") {
	window.CONFIG = CONFIG;
}
