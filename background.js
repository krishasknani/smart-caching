chrome.runtime.onInstalled.addListener(async () => {
	console.log("Cache-22 installed");
	await loadConfig();
});

chrome.action.onClicked.addListener((tab) => {});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete" && tab.url) {
		console.log("Tab updated:", tab.url);
	}
});

chrome.history.onVisited.addListener(async (historyItem) => {
	try {
		const isFirstTime = await isFirstTimeAnalysis();
		if (isFirstTime) {
			console.log(
				"First analysis not complete, skipping auto-cache for:",
				historyItem.url
			);
			return;
		}

		const autoCacheEnabled = await isAutoCachingEnabled();
		if (!autoCacheEnabled) {
			console.log("Auto-caching disabled, skipping:", historyItem.url);
			return;
		}

		if (await isRecentlyAnalyzed(historyItem.url)) {
			console.log("URL recently analyzed, skipping:", historyItem.url);
			return;
		}

		await autoAnalyzeAndCache(historyItem.url);
	} catch (error) {
		console.error("Error in history listener:", error);
	}
});

let CONFIG = null;

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

function extractConfigFromText(configText) {
	try {
		const config = {};
		const apiKeyMatch = configText.match(/CLAUDE_API_KEY:\s*"([^"]+)"/);
		if (apiKeyMatch) config.CLAUDE_API_KEY = apiKeyMatch[1];

		const apiUrlMatch = configText.match(/CLAUDE_API_URL:\s*"([^"]+)"/);
		if (apiUrlMatch) config.CLAUDE_API_URL = apiUrlMatch[1];

		const modelMatch = configText.match(/CLAUDE_MODEL:\s*"([^"]+)"/);
		if (modelMatch) config.CLAUDE_MODEL = modelMatch[1];

		const cacheMatch = configText.match(/CACHE_DURATION_HOURS:\s*(\d+)/);
		if (cacheMatch) config.CACHE_DURATION_HOURS = parseInt(cacheMatch[1]);

		const historyMatch = configText.match(/MAX_HISTORY_ITEMS:\s*(\d+)/);
		if (historyMatch) config.MAX_HISTORY_ITEMS = parseInt(historyMatch[1]);

		const tabsMatch = configText.match(/MAX_TABS_ITEMS:\s*(\d+)/);
		if (tabsMatch) config.MAX_TABS_ITEMS = parseInt(tabsMatch[1]);

		const brightDataTokenMatch = configText.match(
			/BRIGHTDATA_TOKEN:\s*"([^"]+)"/
		);
		if (brightDataTokenMatch) config.BRIGHTDATA_TOKEN = brightDataTokenMatch[1];

		const brightDataZoneMatch = configText.match(
			/BRIGHTDATA_ZONE:\s*"([^"]+)"/
		);
		if (brightDataZoneMatch) config.BRIGHTDATA_ZONE = brightDataZoneMatch[1];

		const serpCountMatch = configText.match(/SERP_RESULTS_PER_QUERY:\s*(\d+)/);
		if (serpCountMatch)
			config.SERP_RESULTS_PER_QUERY = parseInt(serpCountMatch[1]);

		const playwrightEnabledMatch = configText.match(
			/PLAYWRIGHT_ENABLED:\s*(true|false)/
		);
		if (playwrightEnabledMatch)
			config.PLAYWRIGHT_ENABLED = playwrightEnabledMatch[1] === "true";

		const playwrightUrlMatch = configText.match(
			/PLAYWRIGHT_SERVER_URL:\s*"([^"]+)"/
		);
		if (playwrightUrlMatch)
			config.PLAYWRIGHT_SERVER_URL = playwrightUrlMatch[1];

		const playwrightTimeoutMatch = configText.match(
			/PLAYWRIGHT_TIMEOUT:\s*(\d+)/
		);
		if (playwrightTimeoutMatch)
			config.PLAYWRIGHT_TIMEOUT = parseInt(playwrightTimeoutMatch[1]);

		return config;
	} catch (error) {
		console.error("Error extracting config from text:", error);
		return null;
	}
}

async function ensureConfigLoaded() {
	try {
		if (CONFIG && typeof CONFIG === "object") return true;
		const ok = await loadConfig();
		if (ok && CONFIG) return true;
	} catch (e) {
		console.warn("ensureConfigLoaded error:", e);
	}
	throw new Error("Configuration not loaded");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request?.type === "FLIGHT_EVENT_DETECTED") {
		handleCalendarFlightDetected(request.payload).catch((e) =>
			console.warn("Calendar flight handler failed:", e)
		);
		return;
	}

	if (request.action === "analyzeWithClaude") {
		ensureConfigLoaded()
			.then(() => handleClaudeAnalysis(request.data))
			.then((result) => sendResponse({ success: true, data: result }))
			.catch((error) => sendResponse({ success: false, error: error.message }));
		return true;
	}

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

				const result = await runSmartCaching(
					token,
					zone,
					queries,
					resultsPerQuery
				);
				sendResponse(result);
			} catch (err) {
				sendResponse({ ok: false, error: String(err?.message || err) });
			}
		})();
		return true;
	}

	if (request.action === "getPageContent") {
		(async () => {
			try {
				console.log("📥 Received cache request for URL:", request.url);
				console.log("⚙️ Cache options:", {
					maxDepth: request.maxDepth || 0,
					forceSimple: request.forceSimple || false,
				});

				await ensureConfigLoaded();
				console.log("✅ Config loaded, starting cache process...");

				const result = await smartCachePage(request.url, {
					maxDepth: request.maxDepth || 0,
					forceSimple: request.forceSimple || false,
				});

				console.log("✅ Cache process completed successfully");
				console.log("📊 Method used:", result.method);
				console.log("📊 Stats:", result.stats);

				sendResponse({
					success: true,
					method: result.method,
					stats: result.stats,
				});
			} catch (error) {
				console.error("❌ Error caching page:", error);
				sendResponse({
					success: false,
					error: error.message,
				});
			}
		})();
		return true;
	}
});

let __lastFlightTrigger = { hash: null, at: 0 };
let __flightDetectionCooldown = 0;

function hashString(s) {
	try {
		let h = 0;
		for (let i = 0; i < s.length; i++) {
			h = (h * 31 + s.charCodeAt(i)) | 0;
		}
		return String(h);
	} catch {
		return String(Math.random());
	}
}

async function handleCalendarFlightDetected(payload = {}) {
	const { text = "", urls = [], pageUrl = "" } = payload || {};

	const now = Date.now();

	if (now - __flightDetectionCooldown < 5 * 60 * 1000) {
		console.log("⏸️ Flight detection in cooldown period, ignoring");
		return;
	}

	const statusCheck = await chrome.storage.local.get(["flightDetectionStatus"]);
	if (statusCheck.flightDetectionStatus?.active) {
		console.log("⏸️ Flight detection already active, ignoring");
		return;
	}

	const hash = hashString(text);
	if (
		__lastFlightTrigger.hash === hash &&
		now - __lastFlightTrigger.at < 10 * 60 * 1000
	) {
		console.log("⏭️ Duplicate flight trigger, ignoring");
		return;
	}
	__lastFlightTrigger = { hash, at: now };
	__flightDetectionCooldown = now;

	console.log("✈️ Flight-like calendar event detected:", text);

	await chrome.storage.local.set({
		flightDetectionStatus: {
			active: true,
			flightText: text,
			timestamp: now,
			stage: "analyzing",
		},
	});

	await ensureConfigLoaded();

	try {
		const queries = extractQueriesFromFlightText(text);
		if (urls.length) queries.push(...urls);

		if (!queries.length) {
			console.warn("No queries extracted from flight event");
			await chrome.storage.local.set({
				flightDetectionStatus: {
					active: false,
					stage: "failed",
					completedAt: Date.now(),
				},
			});
			return;
		}

		console.log("Extracted flight queries:", queries);

		await chrome.storage.local.set({
			flightDetectionStatus: {
				active: true,
				flightText: text,
				timestamp: now,
				stage: "caching",
				queries,
			},
		});

		const token = (CONFIG?.BRIGHTDATA_TOKEN || "").trim();
		const zone = (CONFIG?.BRIGHTDATA_ZONE || "").trim();

		if (token && zone) {
			const response = await runSmartCaching(token, zone, queries, 3);
			if (response?.ok) {
				console.log(
					`Flight caching complete: ${response.scraped} pages cached`
				);
				await chrome.storage.local.set({
					flightDetectionStatus: {
						active: false,
						stage: "completed",
						queries,
						pagesCached: response.scraped,
						completedAt: Date.now(),
					},
				});
			} else {
				throw new Error(response?.error || "Unknown error");
			}
		} else {
			console.warn("Bright Data credentials missing, using fallback");
			await chrome.storage.local.set({
				flightDetectionStatus: {
					active: true,
					stage: "fallback",
					queries,
				},
			});
			for (const q of queries.slice(0, 3)) {
				try {
					await smartCachePage(q, { maxDepth: 0, forceSimple: true });
				} catch {}
			}
			await chrome.storage.local.set({
				flightDetectionStatus: {
					active: false,
					stage: "completed",
					queries,
					pagesCached: queries.length,
					completedAt: Date.now(),
				},
			});
		}
	} catch (err) {
		console.error("Flight caching failed:", err);
		await chrome.storage.local.set({
			flightDetectionStatus: {
				active: false,
				stage: "failed",
				error: String(err?.message || err),
				completedAt: Date.now(),
			},
		});
	}
}

async function checkPlaywrightServer() {
	try {
		if (!CONFIG?.PLAYWRIGHT_ENABLED) return false;
		const url = `${CONFIG.PLAYWRIGHT_SERVER_URL}/api/health`;
		const res = await fetch(url, {
			method: "GET",
			signal: AbortSignal.timeout(3000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

async function cacheWithPlaywright(url, maxDepth = 0) {
	console.log("🎭 Playwright caching started");
	const api = (CONFIG?.PLAYWRIGHT_SERVER_URL || "").replace(/\/$/, "");
	const timeoutMs = Number(CONFIG?.PLAYWRIGHT_TIMEOUT) || 60000;
	console.log("🌐 Playwright server URL:", api);
	console.log("⏱️ Timeout:", timeoutMs, "ms");

	console.log("📤 Sending POST request to Playwright server...");
	const resp = await fetch(`${api}/api/cache`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url, maxDepth }),
		signal: AbortSignal.timeout(timeoutMs),
	});

	console.log("📥 Playwright server response status:", resp.status);

	if (!resp.ok) {
		throw new Error(`Playwright server error ${resp.status}`);
	}
	const data = await resp.json();
	console.log("📊 Playwright response data:", data);

	if (!data?.success || !data?.cacheHash) {
		throw new Error("Playwright caching failed");
	}

	console.log("🔑 Cache hash:", data.cacheHash);
	console.log("📥 Fetching cached HTML...");

	// Fetch the cached index.html and store in extension storage for offline viewing inside popup
	const cachedHtmlRes = await fetch(
		`${api}/cached/${data.cacheHash}/index.html`,
		{
			method: "GET",
			signal: AbortSignal.timeout(Math.min(timeoutMs, 20000)),
		}
	);

	console.log("📥 Cached HTML fetch status:", cachedHtmlRes.status);

	if (!cachedHtmlRes.ok)
		throw new Error(`Cached HTML fetch failed ${cachedHtmlRes.status}`);
	const content = await cachedHtmlRes.text();
	const title = extractTitleFromHtml(content) || url;

	console.log("📌 Extracted title:", title);
	console.log("📦 Content length:", content.length);

	const pageData = { url, title, content, timestamp: Date.now(), favicon: "" };

	console.log("💾 Saving Playwright-cached page to storage...");
	await saveCachedPage(pageData);
	console.log("✅ Playwright-cached page saved successfully");

	return { cacheHash: data.cacheHash, stats: data.stats || null };
}

async function smartCachePage(url, { maxDepth = 0, forceSimple = false } = {}) {
	console.log("🔍 Smart cache page called for:", url);
	console.log("🔧 Options:", { maxDepth, forceSimple });

	if (!url || typeof url !== "string") throw new Error("Invalid URL");
	if (isRestrictedUrl(url)) throw new Error("Restricted URL");

	const wantPlaywright = !!CONFIG?.PLAYWRIGHT_ENABLED && !forceSimple;
	console.log("🎭 Playwright wanted:", wantPlaywright);

	if (wantPlaywright && (await checkPlaywrightServer())) {
		try {
			console.log("🎭 Attempting Playwright caching...");
			const res = await cacheWithPlaywright(url, maxDepth);
			console.log("✅ Playwright caching successful");
			return { method: "playwright", stats: res.stats };
		} catch (e) {
			console.warn("⚠️ Playwright caching failed, falling back to simple:", e);
			// fall through to simple
		}
	} else if (wantPlaywright) {
		console.log("⚠️ Playwright server not available, using simple caching");
	}

	console.log("📄 Using simple offscreen caching...");
	const { content, title } = await scrapePage(url);
	console.log("📦 Content retrieved, length:", content?.length || 0);
	console.log("📌 Page title:", title);

	if (!content) throw new Error("Empty content");

	const pageData = {
		url,
		title: title || url,
		content,
		timestamp: Date.now(),
		favicon: "",
	};

	console.log("💾 Saving page to storage...");
	await saveCachedPage(pageData);
	console.log("✅ Page saved successfully");

	return { method: "simple", stats: null };
}

async function prepareDataForClaudeBackground() {
	const maxHist = Math.min(
		clampInt(CONFIG?.MAX_HISTORY_ITEMS, 100, 200000, 1000),
		1000
	);
	const maxTabs = Math.min(
		clampInt(CONFIG?.MAX_TABS_ITEMS, 10, 5000, 100),
		100
	);

	const historyItems = await new Promise((resolve) => {
		try {
			chrome.history.search(
				{ text: "", startTime: 0, maxResults: maxHist },
				(items) => resolve(Array.isArray(items) ? items : [])
			);
		} catch (e) {
			console.warn("history.search failed:", e);
			resolve([]);
		}
	});

	const tabs = await new Promise((resolve) => {
		try {
			chrome.tabs.query({}, (ts) => resolve(Array.isArray(ts) ? ts : []));
		} catch (e) {
			console.warn("tabs.query failed:", e);
			resolve([]);
		}
	});

	return {
		browser_history: historyItems.slice(0, 500).map((h) => ({
			url: h.url,
			title: h.title,
			lastVisitTime: h.lastVisitTime,
		})),
		current_tabs: tabs
			.slice(0, 50)
			.map((t) => ({ url: t.url, title: t.title })),
	};
}

function generateQueriesFromCategoriesBackground(categories, maxQueries = 10) {
	const out = [];
	for (const cat of categories || []) {
		if (cat?.keywords) out.push(...(cat.keywords || []));
		if (cat?.name) out.push(String(cat.name));
		if (Array.isArray(cat?.urls)) {
			// derive a couple of hostnames as queries (broad)
			for (const u of cat.urls) {
				try {
					const host = new URL(u).hostname.replace(/^www\./, "");
					if (host) out.push(host);
				} catch {}
			}
		}
	}
	return Array.from(
		new Set(out.map((q) => (q || "").toString().trim()).filter(Boolean))
	).slice(0, maxQueries);
}

function extractQueriesFromFlightText(text = "") {
	const queries = [];
	try {
		const airlineCode = (text.match(/(?:^|\s)([A-Z]{2})\s?\d{2,4}(?=\b)/) ||
			[])[1];
		const airports = text.match(/\b[A-Z]{3}\b/g) || [];
		if (airlineCode) queries.push(`${airlineCode} flight status`);
		if (airports.length >= 2) {
			queries.push(`${airports[0]} to ${airports[1]} flights`);
			queries.push(`${airports[0]} ${airports[1]} flight status`);
		}
		queries.push(
			"check in",
			"boarding pass",
			"manage booking",
			"baggage policy"
		);
	} catch {}
	return Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
}

async function callClaudeAPI(data) {
	try {
		if (!CONFIG.CLAUDE_API_KEY) {
			throw new Error("Claude API key not found in configuration.");
		}

		function createClaudePrompt(data) {
			try {
				const history = Array.isArray(data?.browser_history)
					? data.browser_history.slice(0, 200)
					: [];
				const tabs = Array.isArray(data?.current_tabs) ? data.current_tabs : [];

				const truncateText = (text, maxLen = 100) => {
					if (!text) return "Untitled";
					return text.length > maxLen
						? text.substring(0, maxLen) + "..."
						: text;
				};

				const historyPreview = history
					.slice(0, 100)
					.map(
						(h, i) =>
							`${i + 1}. ${truncateText(h.title)} — ${truncateText(h.url, 80)}`
					)
					.join("\n");

				const tabsPreview = tabs
					.slice(0, 30)
					.map(
						(t, i) =>
							`${i + 1}. ${truncateText(t.title)} — ${truncateText(t.url, 80)}`
					)
					.join("\n");

				return `You are given anonymized browsing data. Infer 5-8 high-level content categories the user is interested in.\n\nReturn ONLY a JSON array. Each item must have the following fields:\n- "category_name": short human-readable string (e.g., "Travel: Flights", "AI/ML News")\n- "name": optional alias of category_name (string)\n- "description": 1-2 sentences summarizing the theme (string)\n- "confidence": number between 0 and 1 (e.g., 0.82)\n- "keywords": array of 3-6 representative keywords/phrases (strings)\n- "urls": array of up to 5 representative URLs from the input (strings)\n\nStrict JSON ONLY. No markdown, no code fences, no extra commentary.\n\nContext:\n- Recent History (sample):\n${
					historyPreview || "(none)"
				}\n- Open Tabs (sample):\n${tabsPreview || "(none)"}`;
			} catch (e) {
				return "[]";
			}
		}

		const response = await fetch(CONFIG.CLAUDE_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": CONFIG.CLAUDE_API_KEY,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify({
				model: CONFIG.CLAUDE_MODEL || "claude-3-5-haiku-latest",
				max_tokens: 2048,
				temperature: 0.2,
				messages: [{ role: "user", content: createClaudePrompt(data) }],
			}),
		});
		if (!response.ok) {
			let errorData = {};
			try {
				errorData = await response.json();
			} catch {}
			throw new Error(
				`Claude API error: ${response.status} - ${
					errorData.error?.message || "Unknown error"
				}`
			);
		}

		const result = await response.json();
		console.log("Claude API response:", result);
		const text = result?.content?.[0]?.text || "";
		console.log("Claude response content:", text);
		return text;
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

			// Try to parse - if it fails, it might be truncated
			try {
				categories = JSON.parse(cleanResponse);
			} catch (parseErr) {
				console.warn(
					"Initial parse failed, attempting to fix truncated JSON..."
				);

				// Try to fix common truncation issues
				// If the JSON ends abruptly, try to close it properly
				if (!cleanResponse.trim().endsWith("]")) {
					// Try to find the last complete object and close the array
					const lastCompleteObj = cleanResponse.lastIndexOf("}");
					if (lastCompleteObj > 0) {
						cleanResponse =
							cleanResponse.substring(0, lastCompleteObj + 1) + "\n]";
						console.log("Attempted to fix truncated JSON:", cleanResponse);
						categories = JSON.parse(cleanResponse);
					} else {
						throw parseErr;
					}
				} else {
					throw parseErr;
				}
			}

			console.log("Successfully parsed categories:", categories);
		} catch (parseError) {
			console.error("Error parsing Claude response:", parseError);
			console.error("Raw response that failed to parse:", claudeResponse);
			console.error("Parse error details:", parseError.message);
			throw new Error(
				"Failed to parse Claude response. The response may be incomplete. Please try again."
			);
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
	console.log("🔍 Starting offscreen scraping for:", url);
	await ensureOffscreen();
	console.log("✅ Offscreen document ready");

	return new Promise((resolve, reject) => {
		const requestId = Math.random().toString(36).slice(2);
		console.log("🔑 Scrape request ID:", requestId);

		const onMsg = (msg) => {
			if (msg?.type === "SCRAPE_RESULT" && msg.requestId === requestId) {
				console.log("📥 Received scrape result for request:", requestId);
				chrome.runtime.onMessage.removeListener(onMsg);
				if (msg.error) {
					console.error("❌ Scraping error:", msg.error);
					reject(new Error(msg.error));
				} else {
					console.log("✅ Scraping successful");
					console.log("📦 Content length:", msg.content?.length || 0);
					console.log("📌 Title:", msg.title);
					resolve({ content: msg.content, title: msg.title });
				}
			}
		};
		chrome.runtime.onMessage.addListener(onMsg);
		console.log("📤 Sending scrape request to offscreen document...");
		chrome.runtime.sendMessage({ type: "SCRAPE_URL", url, requestId });
		setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onMsg);
			console.error("⏱️ Offscreen scraping timeout after 25s");
			reject(new Error("Offscreen timeout"));
		}, 25000);
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
	console.log("💾 Saving cached page to storage...");
	console.log("📄 Page URL:", pageData.url);
	console.log("📌 Page title:", pageData.title);

	const existing =
		(await chrome.storage.local.get(["cachedPages"]))?.cachedPages || [];
	console.log("📚 Existing cached pages count:", existing.length);

	existing.push(pageData);
	await chrome.storage.local.set({ cachedPages: existing });

	console.log("✅ Page saved! Total cached pages:", existing.length);
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
		if (!token || token.trim() === "")
			throw new Error("Missing Bright Data token");
		if (!zone || zone.trim() === "")
			throw new Error("Missing Bright Data zone");

		// Normalize and deduplicate queries
		let normalizedQueries = Array.isArray(queries)
			? queries.filter((q) => q && q.trim())
			: [];
		normalizedQueries = [
			...new Set(
				normalizedQueries.map((q) =>
					q.replace(/\s+/g, " ").trim().toLowerCase()
				)
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

		// Decide caching strategy: prefer Playwright if available, else fallback per-URL
		const usePlaywright =
			!!CONFIG?.PLAYWRIGHT_ENABLED && (await checkPlaywrightServer());

		const results = [];
		for (const url of toScrape) {
			try {
				if (usePlaywright) {
					// Try advanced caching first
					const res = await cacheWithPlaywright(url, 0);
					results.push({
						url,
						status: "cached",
						method: "playwright",
						cacheHash: res?.cacheHash,
					});
				} else {
					// Fallback to simple offscreen scraping
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
					results.push({ url, status: "cached", method: "simple" });
				}
			} catch (err) {
				// If Playwright fails for a URL, try simple scraping as a per-URL fallback
				if (usePlaywright) {
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
						results.push({ url, status: "cached", method: "simple" });
						continue;
					} catch (fallbackErr) {
						console.warn(
							"Playwright and simple caching both failed",
							url,
							fallbackErr
						);
					}
				} else {
					console.warn("Failed to cache", url, err);
				}
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
			usedPlaywright: usePlaywright === true,
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
		const result = await chrome.storage.local.get(["firstAnalysisComplete"]);
		return !result.firstAnalysisComplete;
	} catch (error) {
		console.error("Error checking first-time analysis status:", error);
		return true; // Default to first time if error
	}
}

// Check if auto-caching is enabled
async function isAutoCachingEnabled() {
	try {
		const result = await chrome.storage.local.get(["autoCachingEnabled"]);
		return result.autoCachingEnabled !== false; // Default to enabled
	} catch (error) {
		console.error("Error checking auto-caching status:", error);
		return true; // Default to enabled
	}
}

// Check if URL was recently analyzed
async function isRecentlyAnalyzed(url) {
	try {
		const result = await chrome.storage.local.get(["analyzedUrls"]);
		const analyzedUrls = result.analyzedUrls || {};
		const lastAnalyzed = analyzedUrls[url];

		// Don't analyze if analyzed within last 24 hours
		return lastAnalyzed && Date.now() - lastAnalyzed < 24 * 60 * 60 * 1000;
	} catch (error) {
		console.error("Error checking if URL was recently analyzed:", error);
		return false;
	}
}

// (removed duplicate/corrupted createClaudePrompt and callClaudeAPI definitions)

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
			timestamp: Date.now(),
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
			method: "GET",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
			},
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
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": CONFIG.CLAUDE_API_KEY,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify({
				model: CONFIG.CLAUDE_MODEL,
				max_tokens: 2000,
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

		const queries = JSON.parse(cleanResponse);

		// Validate that it's an array of strings
		if (Array.isArray(queries) && queries.every((q) => typeof q === "string")) {
			return queries.filter((q) => q.trim().length > 0);
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
			type: "basic",
			iconUrl: "icons/icon48.png",
			title: "Cache-22 Auto-Caching",
			message: `Cached ${pagesCached} related pages for ${
				new URL(url).hostname
			}`,
			priority: 1,
		};

		// Note: Chrome notifications require permission in manifest
		// For now, we'll just log it
		console.log("Auto-cache notification:", notification.message);

		// TODO: Implement proper notification system
	} catch (error) {
		console.error("Error showing auto-cache notification:", error);
	}
}
