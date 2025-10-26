// Example configuration file for Smart Caching Extension
// Copy this file to config.js and add your actual API key

const CONFIG = {
	// Baseten API Configuration
	BASETEN_API_KEY: "your-baseten-api-key-here",

	// Bright Data SERP API (used for smart caching discovery)
	// Get credentials at https://brightdata.com/
	BRIGHTDATA_TOKEN: "your-brightdata-token-here",
	BRIGHTDATA_ZONE: "your-brightdata-zone-here",
	// Optional: how many results to fetch per query
	SERP_RESULTS_PER_QUERY: 5,

	// API Settings
	BASETEN_API_URL: "https://inference.baseten.co/v1/chat/completions",
	BASETEN_MODEL: "openai/gpt-oss-120b",

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
