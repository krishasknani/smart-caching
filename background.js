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

// Listen for browser history changes to trigger auto-caching
chrome.history.onVisited.addListener(async (historyItem) => {
	try {
		// Skip if this is a tab we created for content extraction
		if (isExtractionTab(historyItem.url)) {
			console.log("Skipping extraction tab:", historyItem.url);
			return;
		}

		// Check if first analysis has been completed
		const isFirstTime = await isFirstTimeAnalysis();
		if (isFirstTime) {
			console.log("First analysis not complete, skipping auto-cache for:", historyItem.url);
			return;
		}

		// Check if auto-caching is enabled
		const autoCacheEnabled = await isAutoCachingEnabled();
		if (!autoCacheEnabled) {
			console.log("Auto-caching disabled, skipping:", historyItem.url);
			return;
		}

		// Check if URL was recently analyzed
		if (await isRecentlyAnalyzed(historyItem.url)) {
			console.log("URL recently analyzed, skipping:", historyItem.url);
			return;
		}

		// Trigger auto-caching for this URL
		await autoAnalyzeAndCache(historyItem.url);
	} catch (error) {
		console.error("Error in history listener:", error);
	}
});

// ===== CLAUDE API INTEGRATION =====

// Load configuration
let CONFIG = null;

// Load config file
async function loadConfig() {
	try {
		console.log("Attempting to load config.js...");
		const configUrl = chrome.runtime.getURL("config.js");
		console.log("Config URL:", configUrl);

		const response = await fetch(configUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch config: ${response.status} ${response.statusText}`
			);
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
			cacheDuration: CONFIG.CACHE_DURATION_HOURS,
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

		// Extract Bright Data token
		const brightDataTokenMatch = configText.match(
			/BRIGHTDATA_TOKEN:\s*"([^"]+)"/
		);
		if (brightDataTokenMatch) {
			config.BRIGHTDATA_TOKEN = brightDataTokenMatch[1];
		}

		// Extract Bright Data zone
		const brightDataZoneMatch = configText.match(
			/BRIGHTDATA_ZONE:\s*"([^"]+)"/
		);
		if (brightDataZoneMatch) {
			config.BRIGHTDATA_ZONE = brightDataZoneMatch[1];
		}

		// Optional: results per query for SERP
		const serpCountMatch = configText.match(/SERP_RESULTS_PER_QUERY:\s*(\d+)/);
		if (serpCountMatch) {
			config.SERP_RESULTS_PER_QUERY = parseInt(serpCountMatch[1]);
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
			.then((result) => sendResponse({ success: true, data: result }))
			.catch((error) => sendResponse({ success: false, error: error.message }));
		return true; // Keep message channel open for async response
	}

	// Smart Caching: Run Bright Data SERP search -> scrape -> cache
	if (request?.action === "runSmartCaching") {
		(async () => {
			try {
				await ensureConfigLoaded();
				const token = (request.token || CONFIG.BRIGHTDATA_TOKEN || "").trim();
				const zone = (request.zone || CONFIG.BRIGHTDATA_ZONE || "").trim();
				let queries = Array.isArray(request.queries)
					? request.queries.filter((q) => q && q.trim())
					: [];
				const resultsPerQuery = clampInt(
					request.resultsPerQuery ?? CONFIG.SERP_RESULTS_PER_QUERY,
					1,
					20,
					5
				);

				const result = await runSmartCaching(token, zone, queries, resultsPerQuery);
				sendResponse(result);
			} catch (err) {
				sendResponse({ ok: false, error: String(err?.message || err) });
			}
		})();
		return true; // async
	}
});

// Ensure config is loaded before processing requests
async function ensureConfigLoaded() {
	if (!CONFIG) {
		console.log("Config not loaded, attempting to load...");
		const loaded = await loadConfig();
		if (!loaded || !CONFIG) {
			throw new Error(
				"Failed to load configuration. Please check that config.js exists and is accessible."
			);
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
		.map((item) => item.url)
		.filter((url) => url && url.length < 200) // Filter out very long URLs
		.slice(0, 50); // Limit to first 50 for prompt length

	const tabUrls = data.current_tabs
		.map((tab) => tab.url)
		.filter((url) => url && url.length < 200); // Filter out very long URLs

	return `Analyze the following browser history and current tabs. Group the URLs into relevant categories/topics based on their content and purpose.

BROWSER HISTORY URLs (${data.total_history_items} total, showing first 50):
${historyUrls.join("\n")}

CURRENT TABS URLs (${data.total_open_tabs} total):
${tabUrls.join("\n")}

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
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": CONFIG.CLAUDE_API_KEY,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify({
				model: CONFIG.CLAUDE_MODEL,
				max_tokens: 4000,
				messages: [
					{
						role: "user",
						content: prompt,
					},
				],
			}),
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(
				`Claude API error: ${response.status} - ${
					errorData.error?.message || "Unknown error"
				}`
			);
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
			if (cleanResponse.startsWith("```json")) {
				cleanResponse = cleanResponse.replace(/^```json\s*/, "");
			}
			if (cleanResponse.startsWith("```")) {
				cleanResponse = cleanResponse.replace(/^```\s*/, "");
			}
			if (cleanResponse.endsWith("```")) {
				cleanResponse = cleanResponse.replace(/\s*```$/, "");
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
			claudeAnalysisTimestamp: Date.now(),
		});

		console.log("Claude analysis completed:", categories);
		return categories;
	} catch (error) {
		console.error("Error in Claude analysis:", error);
		throw error;
	}
}

// ================= Bright Data SERP + Scraping Helpers =================

async function brightDataSearch(token, zone, query, count = 5) {
	// Construct the Google search URL with the query
	const target = `https://www.google.com/search?q=${encodeURIComponent(
		query
	)}&brd_json=1`;

	let attempt = 0;
	const maxAttempts = 5;
	let lastError;

	while (attempt < maxAttempts) {
		attempt++;
		try {
			const res = await fetch("https://api.brightdata.com/request", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					zone,
					url: target,
					format: "raw",
					country: "US",
				}),
			});

			if (res.ok) {
				const data = await res.json();
				return extractUrlsFromBrightDataResponse(data, count);
			}

			// Not OK: decide whether to retry
			let bodyText = "";
			try {
				bodyText = await res.text();
			} catch {}

			// 429 or 5xx -> retry with backoff
			if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
				lastError = new Error(
					`Bright Data API error ${res.status}: ${bodyText || res.statusText}`
				);
				const delayMs = backoffMs(attempt);
				await sleep(delayMs);
				continue;
			}

			// Other HTTP errors: do not retry
			throw new Error(
				`Bright Data API error ${res.status}: ${bodyText || res.statusText}`
			);
		} catch (err) {
			lastError = err;
			// Network errors -> retry with backoff
			if (attempt < maxAttempts) {
				await sleep(backoffMs(attempt));
				continue;
			}
			break;
		}
	}
	throw lastError || new Error("Unknown Bright Data API error");
}

function backoffMs(attempt) {
	// attempt starts at 1; cap at ~8s
	return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function extractUrlsFromBrightDataResponse(data, count = 5) {
	const urls = [];
	try {
		// With format: "raw", Bright Data returns parsed JSON directly
		// The organic array is directly accessible
		const organic = data?.organic || [];

		// Extract URLs from results
		for (const item of organic) {
			// Use 'link' field from organic results
			const url = item?.link;

			if (url && typeof url === "string") {
				const u = url.trim();
				if (u && (u.startsWith("http://") || u.startsWith("https://"))) {
					urls.push(u);
				}
				if (urls.length >= count) break;
			}
		}
	} catch (err) {
		console.error("Error extracting URLs:", err);
	}
	return urls;
}

function canonicalizeUrl(raw) {
	try {
		const u = new URL(raw);
		u.hash = "";
		u.hostname = u.hostname.toLowerCase();
		const params = new URLSearchParams(u.search);
		const dropPrefixes = ["utm_", "uta_"];
		const dropExact = new Set(["gclid", "fbclid", "igshid"]);
		for (const key of Array.from(params.keys())) {
			if (
				dropExact.has(key) ||
				dropPrefixes.some((p) => key.toLowerCase().startsWith(p))
			) {
				params.delete(key);
			}
		}
		const sorted = new URLSearchParams();
		[...params.keys()].sort().forEach((k) => sorted.set(k, params.get(k)));
		u.search = sorted.toString() ? `?${sorted.toString()}` : "";
		if (u.pathname === "") u.pathname = "/";
		return u.toString();
	} catch {
		return null;
	}
}

function dedupeStrings(arr) {
	return [...new Set(arr.filter(Boolean))];
}

async function ensureOffscreen() {
	const offscreenUrl = chrome.runtime.getURL("offscreen.html");
	const exists = await chrome.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [offscreenUrl],
	});
	if (exists.length === 0) {
		await chrome.offscreen.createDocument({
			url: "offscreen.html",
			reasons: ["DOM_PARSER"], // good fit for parsing HTML
			justification: "Scrape and sanitize pages without opening tabs",
		});
	}
}

async function scrapePage(url) {
	await ensureOffscreen();
	return new Promise((resolve, reject) => {
		const requestId = Math.random().toString(36).slice(2);
		const onMsg = (msg) => {
			if (msg?.type === "SCRAPE_RESULT" && msg.requestId === requestId) {
				chrome.runtime.onMessage.removeListener(onMsg);
				msg.error
					? reject(new Error(msg.error))
					: resolve({ content: msg.content, title: msg.title });
			}
		};
		chrome.runtime.onMessage.addListener(onMsg);
		chrome.runtime.sendMessage({ type: "SCRAPE_URL", url, requestId });
		setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onMsg);
			reject(new Error("Offscreen timeout"));
		}, 25000);
	});
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		let done = false;
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			cleanup();
			reject(new Error("Tab load timeout"));
		}, timeoutMs);

		function onUpdated(updatedId, changeInfo) {
			if (updatedId === tabId && changeInfo.status === "complete") {
				if (done) return;
				done = true;
				cleanup();
				resolve();
			}
		}
		function cleanup() {
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(onUpdated);
		}
		chrome.tabs.onUpdated.addListener(onUpdated);
	});
}

function extractTitleFromHtml(html) {
	if (!html) return null;
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (m && m[1]) {
		const t = m[1].replace(/\s+/g, " ").trim();
		return t || null;
	}
	return null;
}

async function saveCachedPage(pageData) {
	const existing =
		(await chrome.storage.local.get(["cachedPages"]))?.cachedPages || [];
	existing.push(pageData);
	await chrome.storage.local.set({ cachedPages: existing });
}

function clampInt(v, min, max, dflt) {
	const n = Number.parseInt(v, 10);
	if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
	return dflt;
}

// Run smart caching: search, scrape, and cache related pages
async function runSmartCaching(token, zone, queries, resultsPerQuery = 5) {
	try {
		// Validate inputs
		if (!token || token.trim() === "") throw new Error("Missing Bright Data token");
		if (!zone || zone.trim() === "") throw new Error("Missing Bright Data zone");
		
		// Normalize and deduplicate queries
		let normalizedQueries = Array.isArray(queries)
			? queries.filter((q) => q && q.trim())
			: [];
		normalizedQueries = [
			...new Set(
				normalizedQueries.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase())
			),
		];
		// Safety cap in case caller sends too many
		normalizedQueries = normalizedQueries.slice(0, 10);
		
		if (normalizedQueries.length === 0) throw new Error("No queries provided");

		// Search for URLs
		const allUrls = [];
		for (const q of normalizedQueries) {
			const urls = await brightDataSearch(token, zone, q, resultsPerQuery);
			allUrls.push(...urls);
		}

		// Canonicalize and deduplicate URLs
		const candidates = dedupeStrings(
			allUrls.map(canonicalizeUrl).filter(Boolean)
		);

		// Filter out already cached pages
		const existing =
			(await chrome.storage.local.get(["cachedPages"]))?.cachedPages || [];
		const existingSet = new Set(existing.map((p) => p.url));
		const toScrape = candidates.filter((u) => !existingSet.has(u));

		// Scrape and cache each page
		const results = [];
		for (const url of toScrape) {
			try {
				const { content, title } = await scrapePage(url);
				if (!content) throw new Error("Empty content");
				const pageData = {
					url,
					title: title || url,
					content,
					timestamp: Date.now(),
					favicon: "",
				};
				await saveCachedPage(pageData);
				results.push({ url, status: "cached" });
			} catch (err) {
				console.warn("Failed to cache", url, err);
				results.push({
					url,
					status: "error",
					error: String(err?.message || err),
				});
			}
		}

		return {
			ok: true,
			totalCandidates: candidates.length,
			scraped: results.filter((r) => r.status === "cached").length,
			results,
		};
	} catch (err) {
		throw new Error(String(err?.message || err));
	}
}

// ===== AUTO-CACHING FUNCTIONS =====

// Check if first-time analysis has been completed
async function isFirstTimeAnalysis() {
	try {
		const result = await chrome.storage.local.get(['firstAnalysisComplete']);
		return !result.firstAnalysisComplete;
	} catch (error) {
		console.error("Error checking first-time analysis status:", error);
		return true; // Default to first time if error
	}
}

// Check if auto-caching is enabled
async function isAutoCachingEnabled() {
	try {
		const result = await chrome.storage.local.get(['autoCachingEnabled']);
		return result.autoCachingEnabled !== false; // Default to enabled
	} catch (error) {
		console.error("Error checking auto-caching status:", error);
		return true; // Default to enabled
	}
}

// Check if URL was recently analyzed
async function isRecentlyAnalyzed(url) {
	try {
		const result = await chrome.storage.local.get(['analyzedUrls']);
		const analyzedUrls = result.analyzedUrls || {};
		const lastAnalyzed = analyzedUrls[url];
		
		// Don't analyze if analyzed within last 24 hours
		return lastAnalyzed && (Date.now() - lastAnalyzed) < 24 * 60 * 60 * 1000;
	} catch (error) {
		console.error("Error checking if URL was recently analyzed:", error);
		return false;
	}
}

// Mark URL as analyzed
async function markUrlAsAnalyzed(url) {
	try {
		const result = await chrome.storage.local.get(['analyzedUrls']);
		const analyzedUrls = result.analyzedUrls || {};
		analyzedUrls[url] = Date.now();
		await chrome.storage.local.set({ analyzedUrls });
	} catch (error) {
		console.error("Error marking URL as analyzed:", error);
	}
}

// Auto-analyze and cache a single URL
async function autoAnalyzeAndCache(url) {
	try {
		console.log("Auto-caching URL:", url);
		
		// Check if URL is restricted
		if (isRestrictedUrl(url)) {
			console.log("Skipping restricted URL:", url);
			return;
		}

		// Ensure config is loaded
		await ensureConfigLoaded();
		
		// Generate queries based on URL content
		const queries = await generateQueriesFromUrl(url);
		if (queries.length === 0) {
			console.log("No queries generated for URL:", url);
			return;
		}

		// Get Bright Data credentials
		const token = (CONFIG?.BRIGHTDATA_TOKEN || "").trim();
		const zone = (CONFIG?.BRIGHTDATA_ZONE || "").trim();
		if (!token || !zone) {
			console.log("Missing Bright Data credentials, skipping auto-cache");
			return;
		}

		// Run smart caching for this URL
		const resultsPerQuery = CONFIG?.SERP_RESULTS_PER_QUERY || 3; // Fewer results for auto-caching
		const response = await runSmartCaching(token, zone, queries, resultsPerQuery);
		
		if (response?.ok) {
			console.log(`Auto-caching complete for ${url}: ${response.scraped} pages cached`);
			
			// Show notification
			await showAutoCacheNotification(url, response.scraped);
		} else {
			console.error("Auto-caching failed for URL:", url, response?.error);
		}

		// Mark URL as analyzed
		await markUrlAsAnalyzed(url);
		
	} catch (error) {
		console.error("Error in auto-analyze and cache:", error);
	}
}

// Generate queries from a single URL using Claude analysis
async function generateQueriesFromUrl(url) {
	try {
		console.log("Generating queries for URL:", url);
		
		// Try to get content from existing tab first
		let pageContent = await getContentFromExistingTab(url);
		
		// If no existing tab, try background fetch
		if (!pageContent) {
			pageContent = await fetchPageContent(url);
		}
		
		if (!pageContent) {
			console.log("Could not extract content from URL:", url);
			return [];
		}

		// Prepare data for Claude analysis
		const data = {
			url: url,
			title: extractTitleFromHtml(pageContent) || new URL(url).hostname,
			content: pageContent,
			timestamp: Date.now()
		};

		// Send to Claude for analysis
		const claudeResponse = await callClaudeAPIForSingleUrl(data);
		if (!claudeResponse) {
			console.log("Claude analysis failed for URL:", url);
			return [];
		}

		// Parse Claude response and extract queries
		const queries = parseClaudeResponseForQueries(claudeResponse);
		console.log("Generated queries from Claude:", queries);
		
		return queries.slice(0, 3); // Limit to 3 queries for auto-caching
	} catch (error) {
		console.error("Error generating queries from URL:", error);
		return [];
	}
}

// Generate smart queries based on URL analysis
function generateSmartQueriesFromUrl(url) {
	try {
		const urlObj = new URL(url);
		const domain = urlObj.hostname;
		const path = urlObj.pathname;
		const queries = [];
		
		// Domain-based queries
		if (domain.includes('github.com')) {
			queries.push('github repositories programming');
			queries.push('open source projects');
		} else if (domain.includes('stackoverflow.com')) {
			queries.push('programming questions answers');
			queries.push('coding help');
		} else if (domain.includes('youtube.com')) {
			queries.push('video tutorials');
			queries.push('educational content');
		} else if (domain.includes('medium.com')) {
			queries.push('articles blog posts');
			queries.push('tech writing');
		} else if (domain.includes('reddit.com')) {
			queries.push('community discussions');
			queries.push('user experiences');
		} else if (domain.includes('wikipedia.org')) {
			queries.push('encyclopedia information');
			queries.push('reference material');
		} else if (domain.includes('hellointerview.com')) {
			queries.push('interview preparation');
			queries.push('coding practice');
		} else {
			// Generic domain-based query
			queries.push(domain);
		}
		
		// Path-based queries
		if (path && path !== '/' && path.length > 1) {
			const pathParts = path.split('/').filter(part => part.length > 2);
			if (pathParts.length > 0) {
				const pathQuery = pathParts.join(' ');
				queries.push(pathQuery);
			}
		}
		
		// Add general topic queries based on common patterns
		if (path.includes('tutorial') || path.includes('guide')) {
			queries.push('tutorials guides');
		} else if (path.includes('api') || path.includes('documentation')) {
			queries.push('API documentation');
		} else if (path.includes('blog') || path.includes('article')) {
			queries.push('blog articles');
		}
		
		return [...new Set(queries)].filter(q => q.trim().length > 0);
	} catch (error) {
		console.error("Error generating smart queries from URL:", error);
		return [];
	}
}

// Get content from existing tab if user is still on the page
async function getContentFromExistingTab(url) {
	try {
		// Find existing tab with this URL
		const tabs = await chrome.tabs.query({ url: url });
		if (tabs.length > 0) {
			const tab = tabs[0];
			// Send message to content script to get page content
			const response = await chrome.tabs.sendMessage(tab.id, {
				action: "getPageContent",
			});
			
			if (response && response.content) {
				console.log("Got content from existing tab");
				return response.content;
			}
		}
		return null;
	} catch (error) {
		console.log("Could not get content from existing tab:", error.message);
		return null;
	}
}

// Fetch page content using background fetch (no tab creation)
async function fetchPageContent(url) {
	try {
		console.log("Fetching page content via background fetch:", url);
		
		// Use fetch to get the page content
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
			}
		});
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		
		const html = await response.text();
		console.log("Successfully fetched page content via background fetch");
		return html;
	} catch (error) {
		console.log("Background fetch failed:", error.message);
		return null;
	}
}

// Wait for tab to load completely
async function waitForTabLoad(tabId, timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		let done = false;
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			cleanup();
			reject(new Error("Tab load timeout"));
		}, timeoutMs);

		function onUpdated(updatedId, changeInfo) {
			if (updatedId === tabId && changeInfo.status === "complete") {
				if (done) return;
				done = true;
				cleanup();
				resolve();
			}
		}
		function cleanup() {
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(onUpdated);
		}
		chrome.tabs.onUpdated.addListener(onUpdated);
	});
}

// Check if URL is from an extraction tab we created
function isExtractionTab(url) {
	// For now, we'll use a different approach - don't create tabs at all
	// Instead, we'll use a simpler method that doesn't trigger history events
	return false;
}

// Call Claude API for single URL analysis
async function callClaudeAPIForSingleUrl(data) {
	try {
		// Ensure config is loaded
		await ensureConfigLoaded();
		
		if (!CONFIG.CLAUDE_API_KEY) {
			throw new Error("Claude API key not found in configuration.");
		}

		const prompt = createClaudePromptForSingleUrl(data);
		
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
				max_tokens: 2000,
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
		return result.content[0].text;
	} catch (error) {
		console.error("Error calling Claude API for single URL:", error);
		throw error;
	}
}

// Create Claude prompt for single URL analysis
function createClaudePromptForSingleUrl(data) {
	return `Analyze this single webpage and generate 3 relevant search queries that would help find related content.

URL: ${data.url}
Title: ${data.title}
Content: ${data.content.substring(0, 2000)}...

Please return a JSON array of 3 search queries that would help find related content to this page. Focus on:
- The main topic/subject of the page
- Related concepts or technologies mentioned
- Similar content that users might be interested in

Return only a JSON array like this:
["query 1", "query 2", "query 3"]

IMPORTANT: Return ONLY valid JSON. Do not include any markdown formatting, code blocks, or additional text.`;
}

// Parse Claude response to extract queries
function parseClaudeResponseForQueries(claudeResponse) {
	try {
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
		
		const queries = JSON.parse(cleanResponse);
		
		// Validate that it's an array of strings
		if (Array.isArray(queries) && queries.every(q => typeof q === 'string')) {
			return queries.filter(q => q.trim().length > 0);
		} else {
			throw new Error("Invalid query format");
		}
	} catch (parseError) {
		console.error("Error parsing Claude response for queries:", parseError);
		console.error("Raw response:", claudeResponse);
		return [];
	}
}

// Check if URL is restricted
function isRestrictedUrl(url) {
	if (!url) return true;
	const restricted = [
		"chrome://",
		"chrome-extension://",
		"edge://",
		"about:",
		"view-source:",
		"https://chrome.google.com/webstore",
		"https://chromewebstore.google.com",
	];
	return restricted.some((prefix) => url.startsWith(prefix));
}

// Show notification for auto-caching
async function showAutoCacheNotification(url, pagesCached) {
	try {
		// Create a simple notification
		const notification = {
			type: 'basic',
			iconUrl: 'icons/icon48.png',
			title: 'Cache-22 Auto-Caching',
			message: `Cached ${pagesCached} related pages for ${new URL(url).hostname}`,
			priority: 1
		};
		
		// Note: Chrome notifications require permission in manifest
		// For now, we'll just log it
		console.log("Auto-cache notification:", notification.message);
		
		// TODO: Implement proper notification system
	} catch (error) {
		console.error("Error showing auto-cache notification:", error);
	}
}
