// Background service worker
chrome.runtime.onInstalled.addListener(async () => {
	console.log("Smart Caching Extension installed");
	// Load config immediately on installation
	await loadConfig();
});

// Handle extension icon click (optional)
chrome.action.onClicked.addListener((tab) => {
	// This is handled by the popup, but you could add additional logic here
});

// Listen for tab updates to potentially update cache status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete" && tab.url) {
		// Could add logic here to automatically check if page should be cached
		console.log("Tab updated:", tab.url);
	}
});

// ===== CLAUDE API INTEGRATION =====

// Load configuration
let CONFIG = null;

// Load config file
async function loadConfig() {
	try {
		console.log("Attempting to load config.js...");
		const configUrl = chrome.runtime.getURL('config.js');
		console.log("Config URL:", configUrl);
		
		const response = await fetch(configUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
		}
		
		const configText = await response.text();
		console.log("Config file content length:", configText.length);
		
		// Use a more CSP-friendly approach - import the config as a module
		// For now, let's use a simple regex to extract the values
		CONFIG = extractConfigFromText(configText);
		
		if (!CONFIG) {
			throw new Error("CONFIG object not found after parsing config file");
		}
		
		console.log("Configuration loaded successfully:", {
			hasApiKey: !!CONFIG.CLAUDE_API_KEY,
			apiUrl: CONFIG.CLAUDE_API_URL,
			model: CONFIG.CLAUDE_MODEL,
			cacheDuration: CONFIG.CACHE_DURATION_HOURS
		});
		return true;
	} catch (error) {
		console.error("Error loading configuration:", error);
		return false;
	}
}

// Extract config values using regex (CSP-safe)
function extractConfigFromText(configText) {
	try {
		const config = {};
		
		// Extract API key
		const apiKeyMatch = configText.match(/CLAUDE_API_KEY:\s*"([^"]+)"/);
		if (apiKeyMatch) {
			config.CLAUDE_API_KEY = apiKeyMatch[1];
		}
		
		// Extract API URL
		const apiUrlMatch = configText.match(/CLAUDE_API_URL:\s*"([^"]+)"/);
		if (apiUrlMatch) {
			config.CLAUDE_API_URL = apiUrlMatch[1];
		}
		
		// Extract model
		const modelMatch = configText.match(/CLAUDE_MODEL:\s*"([^"]+)"/);
		if (modelMatch) {
			config.CLAUDE_MODEL = modelMatch[1];
		}
		
		// Extract cache duration
		const cacheMatch = configText.match(/CACHE_DURATION_HOURS:\s*(\d+)/);
		if (cacheMatch) {
			config.CACHE_DURATION_HOURS = parseInt(cacheMatch[1]);
		}
		
		// Extract max history items
		const historyMatch = configText.match(/MAX_HISTORY_ITEMS:\s*(\d+)/);
		if (historyMatch) {
			config.MAX_HISTORY_ITEMS = parseInt(historyMatch[1]);
		}
		
		// Extract max tabs items
		const tabsMatch = configText.match(/MAX_TABS_ITEMS:\s*(\d+)/);
		if (tabsMatch) {
			config.MAX_TABS_ITEMS = parseInt(tabsMatch[1]);
		}
		
		return config;
	} catch (error) {
		console.error("Error extracting config from text:", error);
		return null;
	}
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "analyzeWithClaude") {
		// Ensure config is loaded before processing
		ensureConfigLoaded()
			.then(() => handleClaudeAnalysis(request.data))
			.then(result => sendResponse({ success: true, data: result }))
			.catch(error => sendResponse({ success: false, error: error.message }));
		return true; // Keep message channel open for async response
	}
});

// Ensure config is loaded before processing requests
async function ensureConfigLoaded() {
	if (!CONFIG) {
		console.log("Config not loaded, attempting to load...");
		const loaded = await loadConfig();
		if (!loaded || !CONFIG) {
			throw new Error("Failed to load configuration. Please check that config.js exists and is accessible.");
		}
	}
	return true;
}

// Initialize config on startup
chrome.runtime.onStartup.addListener(() => {
	loadConfig();
});

// Create Claude prompt for URL clustering
function createClaudePrompt(data) {
	// Extract URLs from history and tabs, but limit and clean them
	const historyUrls = data.browser_history
		.map(item => item.url)
		.filter(url => url && url.length < 200) // Filter out very long URLs
		.slice(0, 50); // Limit to first 50 for prompt length
	
	const tabUrls = data.current_tabs
		.map(tab => tab.url)
		.filter(url => url && url.length < 200); // Filter out very long URLs
	
	return `Analyze the following browser history and current tabs. Group the URLs into relevant categories/topics based on their content and purpose.

BROWSER HISTORY URLs (${data.total_history_items} total, showing first 50):
${historyUrls.join('\n')}

CURRENT TABS URLs (${data.total_open_tabs} total):
${tabUrls.join('\n')}

Please return a JSON array of categories with the following structure:
[
  {
    "category_name": "string",
    "description": "string explaining what this category represents",
    "urls": ["array of relevant URLs from the data"],
    "confidence": 0.95,
    "keywords": ["array of keywords that define this category"]
  }
]

Focus on creating meaningful categories that reflect the user's interests and browsing patterns. Consider:
- Website domains and purposes
- Content themes and topics
- User behavior patterns
- Frequency of visits

IMPORTANT: Return ONLY valid JSON. Do not include any markdown formatting, code blocks, or additional text.`;
}

// Call Claude API to analyze data
async function callClaudeAPI(data) {
	try {
		// Config should already be loaded by ensureConfigLoaded()
		if (!CONFIG.CLAUDE_API_KEY) {
			throw new Error("Claude API key not found in configuration.");
		}

		const prompt = createClaudePrompt(data);
		
		const response = await fetch(CONFIG.CLAUDE_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': CONFIG.CLAUDE_API_KEY,
				'anthropic-version': '2023-06-01',
				'anthropic-dangerous-direct-browser-access': 'true'
			},
			body: JSON.stringify({
				model: CONFIG.CLAUDE_MODEL,
				max_tokens: 4000,
				messages: [
					{
						role: "user",
						content: prompt
					}
				]
			})
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(`Claude API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
		}

		const result = await response.json();
		console.log("Claude API response:", result);
		console.log("Claude response content:", result.content[0].text);
		return result.content[0].text;
	} catch (error) {
		console.error("Error calling Claude API:", error);
		throw error;
	}
}

// Handle Claude analysis request
async function handleClaudeAnalysis(data) {
	try {
		console.log("Starting Claude analysis...");
		
		// Call Claude API
		const claudeResponse = await callClaudeAPI(data);
		
		// Parse the JSON response
		let categories;
		try {
			console.log("Raw Claude response text:", claudeResponse);
			console.log("Attempting to parse as JSON...");
			
			// Clean the response to extract JSON from markdown code blocks
			let cleanResponse = claudeResponse.trim();
			
			// Remove markdown code block markers if present
			if (cleanResponse.startsWith('```json')) {
				cleanResponse = cleanResponse.replace(/^```json\s*/, '');
			}
			if (cleanResponse.startsWith('```')) {
				cleanResponse = cleanResponse.replace(/^```\s*/, '');
			}
			if (cleanResponse.endsWith('```')) {
				cleanResponse = cleanResponse.replace(/\s*```$/, '');
			}
			
			// Additional cleaning for common JSON issues
			cleanResponse = cleanResponse.trim();
			
			// Try to find the JSON array if it's embedded in other text
			const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				cleanResponse = jsonMatch[0];
			}
			
			console.log("Cleaned response:", cleanResponse);
			categories = JSON.parse(cleanResponse);
			console.log("Successfully parsed categories:", categories);
		} catch (parseError) {
			console.error("Error parsing Claude response:", parseError);
			console.error("Raw response that failed to parse:", claudeResponse);
			console.error("Parse error details:", parseError.message);
			throw new Error("Failed to parse Claude response. Please try again.");
		}

		// Cache the results
		await chrome.storage.local.set({
			claudeCategories: categories,
			claudeAnalysisTimestamp: Date.now()
		});

		console.log("Claude analysis completed:", categories);
		return categories;
	} catch (error) {
		console.error("Error in Claude analysis:", error);
		throw error;
	}
}
