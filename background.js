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
			hasApiKey: !!CONFIG.BASETEN_API_KEY,
			apiUrl: CONFIG.BASETEN_API_URL,
			model: CONFIG.BASETEN_MODEL,
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
		const apiKeyMatch = configText.match(/BASETEN_API_KEY:\s*"([^"]+)"/);
		if (apiKeyMatch) {
			config.BASETEN_API_KEY = apiKeyMatch[1];
		}

		// Extract API URL
		const apiUrlMatch = configText.match(/BASETEN_API_URL:\s*"([^"]+)"/);
		if (apiUrlMatch) {
			config.BASETEN_API_URL = apiUrlMatch[1];
		}

		// Extract model
		const modelMatch = configText.match(/BASETEN_MODEL:\s*"([^"]+)"/);
		if (modelMatch) {
			config.BASETEN_MODEL = modelMatch[1];
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
	if (request.action === "analyzeWithBaseten") {
		// Ensure config is loaded before processing
		ensureConfigLoaded()
			.then(() => handleBasetenAnalysis(request.data))
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
				// Deduplicate and normalize queries to reduce API calls
				queries = [
					...new Set(
						queries.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase())
					),
				];
				// Safety cap in case caller sends too many
				queries = queries.slice(0, 10);
				const resultsPerQuery = clampInt(
					request.resultsPerQuery ?? CONFIG.SERP_RESULTS_PER_QUERY,
					1,
					20,
					5
				);

				if (!token) throw new Error("Missing Bright Data token");
				if (!zone) throw new Error("Missing Bright Data zone");
				if (queries.length === 0) throw new Error("No queries provided");

				const allUrls = [];
				for (const q of queries) {
					const urls = await brightDataSearch(token, zone, q, resultsPerQuery);
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

// Create prompt for URL clustering
function createAnalysisPrompt(data) {
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

Focus on creating meaningful categories that reflect the user's interests and browsing patterns. Consider:
- Website domains and purposes
- Content themes and topics
- User behavior patterns
- Frequency of visits`;
}

// Define JSON schema for structured output
function getCategoriesSchema() {
	return {
		name: "browsing_categories",
		description: "Categories of URLs from browser history and tabs",
		schema: {
			type: "object",
			properties: {
				categories: {
					type: "array",
					description: "Array of categorized URLs",
					items: {
						type: "object",
						properties: {
							category_name: {
								type: "string",
								description: "Name of the category",
							},
							description: {
								type: "string",
								description: "Description of what this category represents",
							},
							urls: {
								type: "array",
								description: "Relevant URLs from the data",
								items: {
									type: "string",
								},
							},
							confidence: {
								type: "number",
								description: "Confidence score between 0 and 1",
								minimum: 0,
								maximum: 1,
							},
							keywords: {
								type: "array",
								description: "Keywords that define this category",
								items: {
									type: "string",
								},
							},
						},
						required: [
							"category_name",
							"description",
							"urls",
							"confidence",
							"keywords",
						],
					},
				},
			},
			required: ["categories"],
		},
		strict: true,
	};
}

// Call Baseten API to analyze data
async function callBasetenAPI(data) {
	try {
		// Config should already be loaded by ensureConfigLoaded()
		if (!CONFIG.BASETEN_API_KEY) {
			throw new Error("Baseten API key not found in configuration.");
		}

		const prompt = createAnalysisPrompt(data);

		const response = await fetch(CONFIG.BASETEN_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Api-Key ${CONFIG.BASETEN_API_KEY}`,
			},
			body: JSON.stringify({
				model: CONFIG.BASETEN_MODEL,
				messages: [
					{
						role: "system",
						content:
							"You are an expert at analyzing browsing patterns and categorizing URLs. Extract meaningful categories from browser history and tabs.",
					},
					{
						role: "user",
						content: prompt,
					},
				],
				response_format: {
					type: "json_object",
					json_schema: getCategoriesSchema(),
				},
				stream: false,
				top_p: 1,
				max_tokens: 4000,
				temperature: 1,
				presence_penalty: 0,
				frequency_penalty: 0,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(
				`Baseten API error: ${response.status} - ${
					errorData.error?.message || "Unknown error"
				}`
			);
		}

		const result = await response.json();
		const content = result.choices[0].message.content;

		// Parse the structured JSON response
		const parsedContent = JSON.parse(content);

		// Extract the categories - handle both array and object formats
		let categories = parsedContent.categories || [];

		// If categories is an object (not array), convert it to array format
		if (
			categories &&
			typeof categories === "object" &&
			!Array.isArray(categories)
		) {
			categories = Object.entries(categories).map(([key, value]) => {
				// Handle different value formats
				let urls = [];
				let description = "";
				let confidence = 0.9;
				let keywords = [key.replace(/_/g, " ").toLowerCase()];

				if (Array.isArray(value)) {
					// Value is directly an array of URLs
					urls = value;
					description = `Category: ${key.replace(/_/g, " ")}`;
				} else if (typeof value === "object") {
					// Value is an object with properties
					description =
						value.description || `Category: ${key.replace(/_/g, " ")}`;
					urls = value.example_urls || value.urls || [];
					confidence = value.confidence || 0.9;
					keywords = value.keywords || keywords;
				}

				return {
					category_name: key.replace(/_/g, " "), // Convert underscores to spaces
					description,
					urls,
					confidence,
					keywords,
				};
			});
		}

		return categories;
	} catch (error) {
		console.error("Error calling Baseten API:", error);
		throw error;
	}
}

// Handle Baseten analysis request
async function handleBasetenAnalysis(data) {
	try {
		// Call Baseten API - now returns parsed categories array directly
		const categories = await callBasetenAPI(data);

		// Validate categories
		if (!Array.isArray(categories)) {
			throw new Error("API did not return an array of categories");
		}

		// Cache the results
		await chrome.storage.local.set({
			basetenCategories: categories,
			basetenAnalysisTimestamp: Date.now(),
		});

		return categories;
	} catch (error) {
		console.error("Error in Baseten analysis:", error);
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
