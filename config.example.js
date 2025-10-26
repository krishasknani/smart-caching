// Example configuration file for Smart Caching Extension
// Copy this file to config.js and add your actual API key

const CONFIG = {
	// Claude API Configuration
	CLAUDE_API_KEY: "your-claude-api-key-here",

	// Brave Search API (used for smart caching discovery)
	// Get a key at https://api.search.brave.com/
	BRAVE_API_KEY: "your-brave-api-key-here",
	// Optional: how many results to fetch per query
	BRAVE_RESULTS_PER_QUERY: 5,

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
