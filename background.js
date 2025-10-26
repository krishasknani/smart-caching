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

		// Extract Brave API key
		const braveKeyMatch = configText.match(/BRAVE_API_KEY:\s*"([^"]+)"/);
		if (braveKeyMatch) {
			config.BRAVE_API_KEY = braveKeyMatch[1];
		}

		// Optional: results per query for Brave
		const braveCountMatch = configText.match(
			/BRAVE_RESULTS_PER_QUERY:\s*(\d+)/
		);
		if (braveCountMatch) {
			config.BRAVE_RESULTS_PER_QUERY = parseInt(braveCountMatch[1]);
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

	// Smart Caching: Run Brave search -> scrape -> cache
	if (request?.action === "runSmartCaching") {
		(async () => {
			try {
				await ensureConfigLoaded();
				const apiKey = (request.apiKey || CONFIG.BRAVE_API_KEY || "").trim();
				let queries = Array.isArray(request.queries)
					? request.queries.filter((q) => q && q.trim())
					: [];
				// Deduplicate and normalize queries to reduce API calls
				queries = [
					...new Set(
						queries.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase())
					),
				];
				// Safety cap in case caller sends too many
				queries = queries.slice(0, 10);
				const resultsPerQuery = clampInt(
					request.resultsPerQuery ?? CONFIG.BRAVE_RESULTS_PER_QUERY,
					1,
					20,
					5
				);

				if (!apiKey) throw new Error("Missing Brave API key");
				if (queries.length === 0) throw new Error("No queries provided");

				const allUrls = [];
				for (const q of queries) {
					const urls = await braveSearch(apiKey, q, resultsPerQuery);
					allUrls.push(...urls);
				}

				const candidates = dedupeStrings(
					allUrls.map(canonicalizeUrl).filter(Boolean)
				);

				const existing =
					(await chrome.storage.local.get(["cachedPages"]))?.cachedPages || [];
				const existingSet = new Set(existing.map((p) => p.url));
				const toScrape = candidates.filter((u) => !existingSet.has(u));

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

				sendResponse({
					ok: true,
					totalCandidates: candidates.length,
					scraped: results.filter((r) => r.status === "cached").length,
					results,
				});
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

// ================= Brave Search + Scraping Helpers =================

async function braveSearch(apiKey, query, count = 5) {
	// Global throttle to respect Brave Free plan rate limits (~1 req/sec)
	// We'll also retry on 429/5xx with exponential backoff.
	await waitForBraveRateLimitSlot();

	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(clampInt(count, 1, 20, 5)));
	url.searchParams.set("country", "US");
	url.searchParams.set("safesearch", "moderate");

	let attempt = 0;
	const maxAttempts = 5;
	let lastError;
	while (attempt < maxAttempts) {
		attempt++;
		try {
			const res = await fetch(url.toString(), {
				method: "GET",
				headers: {
					"X-Subscription-Token": apiKey,
				},
			});

			if (res.ok) {
				const data = await res.json();
				return extractUrlsFromBraveResponse(data);
			}

			// Not OK: decide whether to retry
			let bodyText = "";
			try {
				bodyText = await res.text();
			} catch {}

			// 429 or 5xx -> retry with backoff
			if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
				lastError = new Error(
					`Brave API error ${res.status}: ${bodyText || res.statusText}`
				);
				// Honor Retry-After if provided
				const retryAfter = res.headers.get("retry-after");
				let delayMs = retryAfter
					? Math.min(10000, Math.max(1000, parseFloat(retryAfter) * 1000))
					: backoffMs(attempt);
				await sleep(delayMs);
				// After waiting, also enforce the 1 rps slot again
				await waitForBraveRateLimitSlot();
				continue;
			}

			// Other HTTP errors: do not retry
			throw new Error(
				`Brave API error ${res.status}: ${bodyText || res.statusText}`
			);
		} catch (err) {
			lastError = err;
			// Network errors -> retry with backoff
			if (attempt < maxAttempts) {
				await sleep(backoffMs(attempt));
				await waitForBraveRateLimitSlot();
				continue;
			}
			break;
		}
	}
	throw lastError || new Error("Unknown Brave API error");
}

// Simple global rate limiter state for Brave API
let BRAVE_NEXT_AVAILABLE_TS = 0;
const BRAVE_MIN_INTERVAL_MS = 1100; // 1.1s spacing for safety

async function waitForBraveRateLimitSlot() {
	const now = Date.now();
	const waitMs = Math.max(0, BRAVE_NEXT_AVAILABLE_TS - now);
	if (waitMs > 0) await sleep(waitMs);
	BRAVE_NEXT_AVAILABLE_TS = Date.now() + BRAVE_MIN_INTERVAL_MS;
}

function backoffMs(attempt) {
	// attempt starts at 1; cap at ~8s
	return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function extractUrlsFromBraveResponse(data) {
	const urls = [];
	try {
		const web = data?.web?.results || [];
		for (const item of web) {
			const u = (item?.url || "").trim();
			if (u && (u.startsWith("http://") || u.startsWith("https://")))
				urls.push(u);
		}
	} catch {}
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
