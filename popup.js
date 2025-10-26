document.addEventListener("DOMContentLoaded", function () {
	const cacheButton = document.getElementById("cacheButton");
	const analyzeButton = document.getElementById("analyzeButton");
	const smartCacheButton = document.getElementById("smartCacheButton");
	const autoCacheToggle = document.getElementById("autoCacheToggle");
	const cachedPagesList = document.getElementById("cachedPagesList");
	const categoriesList = document.getElementById("categoriesList");

	// Load configuration
	let CONFIG = null;
	loadConfig();

	// Get current tab info and load sections
	loadCurrentTab();
	loadCachedPages();
	loadCachedCategories();
	
	// Update button state based on first-time analysis
	updateSmartCacheButton();

	// Cache button click handler
	cacheButton.addEventListener("click", function () {
		cacheCurrentPage();
	});

	// Analyze button removed: keep guard if present (backward-compatible)
	if (analyzeButton) {
		analyzeButton.addEventListener("click", function () {
			analyzeBrowsingPatterns();
		});
	}

	// Smart cache button click handler
	if (smartCacheButton) {
		smartCacheButton.addEventListener("click", function () {
			runAnalyzeAndSmartCache();
		});
	}

	// Auto-cache toggle handler
	if (autoCacheToggle) {
		autoCacheToggle.addEventListener("change", function () {
			toggleAutoCaching(this.checked);
		});
		
		// Load current auto-caching preference
		loadAutoCachingPreference();
	}

	// Load configuration
	async function loadConfig() {
		try {
			const response = await fetch(chrome.runtime.getURL("config.js"));
			const configText = await response.text();

			// Extract config values using regex (CSP-safe)
			CONFIG = extractConfigFromText(configText);

			console.log("Configuration loaded successfully in popup");
			return true;
		} catch (error) {
			console.error("Error loading configuration in popup:", error);
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

			// Optional: SERP results per query
			const serpCountMatch = configText.match(
				/SERP_RESULTS_PER_QUERY:\s*(\d+)/
			);
			if (serpCountMatch) {
				config.SERP_RESULTS_PER_QUERY = parseInt(serpCountMatch[1]);
			}

			return config;
		} catch (error) {
			console.error("Error extracting config from text:", error);
			return null;
		}
	}

	// ===== STATE MANAGEMENT FUNCTIONS =====

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

	// Mark first-time analysis as complete
	async function markFirstAnalysisComplete() {
		try {
			await chrome.storage.local.set({ firstAnalysisComplete: true });
			console.log("First analysis marked as complete");
		} catch (error) {
			console.error("Error marking first analysis complete:", error);
		}
	}

	// Update smart cache button state based on first-time analysis
	async function updateSmartCacheButton() {
		try {
			if (!smartCacheButton) return;
			
			const isFirstTime = await isFirstTimeAnalysis();
			if (isFirstTime) {
				smartCacheButton.disabled = false;
				smartCacheButton.textContent = "🧠 Analyze + 🔎 Smart Cache";
			} else {
				smartCacheButton.disabled = true;
				smartCacheButton.textContent = "✅ Analysis Complete - Auto-Caching Active";
			}
		} catch (error) {
			console.error("Error updating smart cache button:", error);
		}
	}

	// ===== AUTO-CACHING PREFERENCE FUNCTIONS =====

	// Load auto-caching preference from storage
	async function loadAutoCachingPreference() {
		try {
			if (!autoCacheToggle) return;
			
			const result = await chrome.storage.local.get(['autoCachingEnabled']);
			const enabled = result.autoCachingEnabled !== false; // Default to enabled
			autoCacheToggle.checked = enabled;
		} catch (error) {
			console.error("Error loading auto-caching preference:", error);
		}
	}

	// Toggle auto-caching preference
	async function toggleAutoCaching(enabled) {
		try {
			await chrome.storage.local.set({ autoCachingEnabled: enabled });
			console.log("Auto-caching", enabled ? "enabled" : "disabled");
		} catch (error) {
			console.error("Error toggling auto-caching:", error);
		}
	}

	// Generate search queries from categories
	function generateQueriesFromCategories(categories, maxQueries = 10) {
		const queries = [];
		for (const cat of categories || []) {
			const name = (cat.category_name || "").trim();
			const kws = Array.isArray(cat.keywords) ? cat.keywords.slice(0, 3) : [];
			if (!name && kws.length === 0) continue;
			const q1 = [name, ...kws].filter(Boolean).join(" ").trim();
			if (q1) queries.push(q1);
			if (kws.length >= 2) queries.push(kws.join(" "));
			if (queries.length >= maxQueries) break;
		}
		return [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))]
			.filter(Boolean)
			.slice(0, maxQueries);
	}

	async function runSmartCachingFromCategories() {
		try {
			if (!smartCacheButton) return;
			smartCacheButton.disabled = true;
			smartCacheButton.textContent = "Caching from categories…";

			// Ensure config loaded
			if (!CONFIG) await loadConfig();
			const token = (CONFIG?.BRIGHTDATA_TOKEN || "").trim();
			const zone = (CONFIG?.BRIGHTDATA_ZONE || "").trim();
			if (!token || !zone) {
				alert(
					"Missing Bright Data credentials. Please set BRIGHTDATA_TOKEN and BRIGHTDATA_ZONE in config.js."
				);
				return;
			}

			// Get categories from storage; if missing, run analysis first
			let { claudeCategories } = await chrome.storage.local.get([
				"claudeCategories",
			]);
			if (!Array.isArray(claudeCategories) || claudeCategories.length === 0) {
				await analyzeBrowsingPatterns();
				({ claudeCategories } = await chrome.storage.local.get([
					"claudeCategories",
				]));
			}
			if (!Array.isArray(claudeCategories) || claudeCategories.length === 0) {
				alert(
					"No categories available to generate queries. Try again after analysis."
				);
				return;
			}

			const queries = generateQueriesFromCategories(claudeCategories, 10);
			if (queries.length === 0) {
				alert("No queries could be generated from categories.");
				return;
			}

			const resultsPerQuery = CONFIG?.SERP_RESULTS_PER_QUERY || 5;
			const response = await chrome.runtime.sendMessage({
				action: "runSmartCaching",
				token,
				zone,
				queries,
				resultsPerQuery,
			});
			if (response?.ok) {
				await loadCachedPages();
				alert(
					`Smart caching complete. Cached ${response.scraped} pages from ${response.totalCandidates} candidates.`
				);
			} else {
				throw new Error(response?.error || "Unknown error");
			}
		} catch (err) {
			console.error("Smart caching error:", err);
			alert(`Smart caching failed: ${String(err?.message || err)}`);
		} finally {
			if (smartCacheButton) {
				smartCacheButton.disabled = false;
				smartCacheButton.textContent = "🧠 Analyze + 🔎 Smart Cache";
			}
		}
	}

	// New: single-button pipeline to analyze and then smart cache
	async function runAnalyzeAndSmartCache() {
		try {
			if (smartCacheButton) {
				smartCacheButton.disabled = true;
				smartCacheButton.textContent = "Analyzing + caching…";
			}

			// Ensure config loaded
			if (!CONFIG) await loadConfig();
			const token = (CONFIG?.BRIGHTDATA_TOKEN || "").trim();
			const zone = (CONFIG?.BRIGHTDATA_ZONE || "").trim();
			if (!token || !zone) {
				alert(
					"Missing Bright Data credentials. Please set BRIGHTDATA_TOKEN and BRIGHTDATA_ZONE in config.js."
				);
				return;
			}

			// Always run fresh analysis
			const categories = await analyzeBrowsingPatterns();
			if (!Array.isArray(categories) || categories.length === 0) {
				alert("No categories produced from analysis.");
				return;
			}

			const queries = generateQueriesFromCategories(categories, 10);
			if (queries.length === 0) {
				alert("No queries could be generated from categories.");
				return;
			}

			const resultsPerQuery = CONFIG?.SERP_RESULTS_PER_QUERY || 5;
			const response = await chrome.runtime.sendMessage({
				action: "runSmartCaching",
				token,
				zone,
				queries,
				resultsPerQuery,
			});
			if (response?.ok) {
				await loadCachedPages();
				
				// Mark first analysis as complete
				await markFirstAnalysisComplete();
				
				alert(
					`Smart caching complete. Cached ${response.scraped} pages from ${response.totalCandidates} candidates. Auto-caching is now active!`
				);
			} else {
				throw new Error(response?.error || "Unknown error");
			}
		} catch (err) {
			console.error("Analyze + Smart cache error:", err);
			alert(`Smart caching failed: ${String(err?.message || err)}`);
		} finally {
			// Update button state based on first-time analysis status
			await updateSmartCacheButton();
		}
	}

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

	async function ensureContentScript(tab) {
		try {
			await chrome.tabs.sendMessage(tab.id, { action: "ping" });
			return true; // already present
		} catch {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					files: ["content.js"],
				});
				// brief delay to allow listener registration
				await new Promise((r) => setTimeout(r, 50));
				return true;
			} catch (e) {
				console.error("Failed to inject content script:", e);
				return false;
			}
		}
	}

	async function loadCurrentTab() {
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab || !tab.url) return;

			if (isRestrictedUrl(tab.url)) {
				cacheButton.disabled = true;
				cacheButton.textContent = "Unavailable on this page";
				return;
			}

			const cachedPages = await getCachedPages();
			const isCached = cachedPages.some((page) => page.url === tab.url);

			cacheButton.disabled = isCached;
			cacheButton.textContent = isCached ? "Already Cached" : "Cache This Page";
		} catch (error) {
			console.error("Error loading current tab:", error);
		}
	}

	async function cacheCurrentPage() {
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab || !tab.url) {
				alert("Unable to get current page information");
				return;
			}
			if (isRestrictedUrl(tab.url)) {
				alert("Cannot cache this page type. Try another page.");
				return;
			}

			// Ensure content script is present (handles first-open case)
			const ok = await ensureContentScript(tab);
			if (!ok) {
				alert(
					"Unable to access this page. Try refreshing the page and try again."
				);
				return;
			}

			// Send message to content script to get page content
			const response = await chrome.tabs.sendMessage(tab.id, {
				action: "getPageContent",
			});

			if (response && response.content) {
				const pageData = {
					url: tab.url,
					title: tab.title || "Untitled",
					content: response.content,
					timestamp: Date.now(),
					favicon: tab.favIconUrl || "",
				};

				// Save to storage
				await saveCachedPage(pageData);

				// Update UI
				cacheButton.disabled = true;
				cacheButton.textContent = "Already Cached";
				loadCachedPages();

				alert("Page cached successfully!");
			} else {
				alert("Unable to cache page content");
			}
		} catch (error) {
			console.error("Error caching page:", error);
			alert("Error caching page. Please try again.");
		}
	}

	async function getCachedPages() {
		try {
			const result = await chrome.storage.local.get(["cachedPages"]);
			return result.cachedPages || [];
		} catch (error) {
			console.error("Error getting cached pages:", error);
			return [];
		}
	}

	async function saveCachedPage(pageData) {
		try {
			const cachedPages = await getCachedPages();
			cachedPages.push(pageData);
			await chrome.storage.local.set({ cachedPages });
		} catch (error) {
			console.error("Error saving cached page:", error);
		}
	}

	async function loadCachedPages() {
		try {
			const cachedPages = await getCachedPages();

			if (cachedPages.length === 0) {
				cachedPagesList.innerHTML =
					'<div class="empty-state">No pages cached yet</div>';
				return;
			}

			// Clear the list first
			cachedPagesList.innerHTML = "";

			// Create each cached page element
			cachedPages.forEach((page, index) => {
				const pageElement = document.createElement("div");
				pageElement.className = "cached-page";
				pageElement.innerHTML = `
          <div class="page-info">
            <div class="page-title">${escapeHtml(page.title)}</div>
            <div class="page-url">${escapeHtml(page.url)}</div>
          </div>
          <button class="view-button" data-url="${escapeHtml(
						page.url
					)}">View</button>
          <button class="delete-button" data-url="${escapeHtml(
						page.url
					)}">Delete</button>
        `;

				// Add event listeners
				const viewButton = pageElement.querySelector(".view-button");
				const deleteButton = pageElement.querySelector(".delete-button");

				viewButton.addEventListener("click", () => viewCachedPage(page.url));
				deleteButton.addEventListener("click", () =>
					deleteCachedPage(page.url)
				);

				cachedPagesList.appendChild(pageElement);
			});
		} catch (error) {
			console.error("Error loading cached pages:", error);
		}
	}

	// Functions for button clicks
	async function viewCachedPage(url) {
		try {
			const cachedPages = await getCachedPages();
			const page = cachedPages.find((p) => p.url === url);

			if (page) {
				// Open cached page in new tab
				const newTab = await chrome.tabs.create({
					url: `data:text/html;charset=utf-8,${encodeURIComponent(
						page.content
					)}`,
					active: true,
				});
			}
		} catch (error) {
			console.error("Error viewing cached page:", error);
		}
	}

	async function deleteCachedPage(url) {
		try {
			const cachedPages = await getCachedPages();
			const filteredPages = cachedPages.filter((p) => p.url !== url);
			await chrome.storage.local.set({ cachedPages: filteredPages });
			loadCachedPages();
		} catch (error) {
			console.error("Error deleting cached page:", error);
		}
	}

	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}

	// ===== SMART CACHING ALGORITHM FUNCTIONS =====

	// Fetch ALL browser history (not just 10 items)
	async function fetchAllBrowserHistory() {
		try {
			console.log("Fetching all browser history...");

			// Get all history items (Chrome limits to 100,000 by default)
			const historyItems = await chrome.history.search({
				text: "",
				maxResults: 100000, // Get as many as possible
				startTime: 0, // From the beginning of time
			});

			// Filter out restricted URLs and clean up the data
			const validHistory = historyItems
				.filter((item) => item.url && !isRestrictedUrl(item.url))
				.map((item) => ({
					url: item.url,
					title: item.title || "Untitled",
					visitCount: item.visitCount || 1,
					lastVisitTime: item.lastVisitTime || 0,
				}));

			console.log(`Fetched ${validHistory.length} history items`);
			return validHistory;
		} catch (error) {
			console.error("Error fetching all browser history:", error);
			return [];
		}
	}

	// Fetch ALL open tabs (not just 10 items)
	async function fetchAllOpenTabs() {
		try {
			console.log("Fetching all open tabs...");

			// Get all tabs across all windows
			const tabs = await chrome.tabs.query({});

			// Filter out restricted URLs and clean up the data
			const validTabs = tabs
				.filter((tab) => tab.url && !isRestrictedUrl(tab.url))
				.map((tab) => ({
					url: tab.url,
					title: tab.title || "Untitled",
					active: tab.active,
					windowId: tab.windowId,
					index: tab.index,
				}));

			console.log(`Fetched ${validTabs.length} open tabs`);
			return validTabs;
		} catch (error) {
			console.error("Error fetching all open tabs:", error);
			return [];
		}
	}

	// Prepare data for Claude API
	async function prepareDataForClaude() {
		try {
			console.log("Preparing data for Claude analysis...");

			const [historyData, tabsData] = await Promise.all([
				fetchAllBrowserHistory(),
				fetchAllOpenTabs(),
			]);

			const dataForClaude = {
				browser_history: historyData,
				current_tabs: tabsData,
				timestamp: Date.now(),
				total_history_items: historyData.length,
				total_open_tabs: tabsData.length,
			};

			console.log("Data prepared for Claude:", {
				historyItems: historyData.length,
				openTabs: tabsData.length,
			});

			return dataForClaude;
		} catch (error) {
			console.error("Error preparing data for Claude:", error);
			return null;
		}
	}

	// Analyze browsing patterns with Claude
	async function analyzeBrowsingPatterns() {
		try {
			// Show loading state (guard if analyzeButton no longer exists)
			if (analyzeButton) {
				analyzeButton.disabled = true;
				analyzeButton.textContent = "🧠 Analyzing...";
			}
			categoriesList.innerHTML =
				'<div class="loading-state">Analyzing your browsing patterns with Claude AI...</div>';

			// Prepare data
			const data = await prepareDataForClaude();
			if (!data) {
				throw new Error("Failed to prepare data for analysis");
			}

			// Send to background script for Claude analysis
			const response = await chrome.runtime.sendMessage({
				action: "analyzeWithClaude",
				data: data,
			});

			if (response.success) {
				// Display the categories
				displayCategories(response.data);
				// Return categories for chaining
				return response.data;
			} else {
				throw new Error(response.error || "Analysis failed");
			}
		} catch (error) {
			console.error("Error analyzing browsing patterns:", error);
			categoriesList.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
			alert(`Analysis failed: ${error.message}`);
			return [];
		} finally {
			// Reset button state
			if (analyzeButton) {
				analyzeButton.disabled = false;
				analyzeButton.textContent = "🧠 Analyze Browsing Patterns";
			}
		}
	}

	// Display categories returned by Claude
	function displayCategories(categories) {
		try {
			if (!categories || categories.length === 0) {
				categoriesList.innerHTML =
					'<div class="empty-state">No categories found</div>';
				return;
			}

			// Clear the list first
			categoriesList.innerHTML = "";

			// Create each category element
			categories.forEach((category) => {
				const categoryElement = document.createElement("div");
				categoryElement.className = "category-item";

				// Create keywords HTML
				const keywordsHtml =
					category.keywords && category.keywords.length > 0
						? `<div class="category-keywords">
							${category.keywords
								.map(
									(keyword) =>
										`<span class="keyword-tag">${escapeHtml(keyword)}</span>`
								)
								.join("")}
					   </div>`
						: "";

				// Create URLs HTML (show first 3 URLs)
				const urlsToShow = category.urls ? category.urls.slice(0, 3) : [];
				const urlsHtml =
					urlsToShow.length > 0
						? `<div class="category-urls">
							URLs: ${urlsToShow.map((url) => escapeHtml(url)).join(", ")}
							${category.urls.length > 3 ? ` (+${category.urls.length - 3} more)` : ""}
					   </div>`
						: "";

				categoryElement.innerHTML = `
					<div class="category-header">
						<div class="category-name">${escapeHtml(
							category.category_name || "Unnamed Category"
						)}</div>
						<div class="category-confidence">${Math.round(
							(category.confidence || 0) * 100
						)}%</div>
					</div>
					<div class="category-description">${escapeHtml(
						category.description || "No description available"
					)}</div>
					${keywordsHtml}
					${urlsHtml}
				`;

				categoriesList.appendChild(categoryElement);
			});
		} catch (error) {
			console.error("Error displaying categories:", error);
			categoriesList.innerHTML =
				'<div class="empty-state">Error displaying categories</div>';
		}
	}

	// Load cached categories on startup
	async function loadCachedCategories() {
		try {
			// Ensure config is loaded
			if (!CONFIG) {
				const configLoaded = await loadConfig();
				if (!configLoaded || !CONFIG) {
					console.warn("Config not loaded, using default cache duration");
				}
			}

			const result = await chrome.storage.local.get([
				"claudeCategories",
				"claudeAnalysisTimestamp",
			]);

			if (result.claudeCategories && result.claudeAnalysisTimestamp) {
				// Check if analysis is less than configured hours old
				const hoursSinceAnalysis =
					(Date.now() - result.claudeAnalysisTimestamp) / (1000 * 60 * 60);
				const cacheDurationHours = CONFIG ? CONFIG.CACHE_DURATION_HOURS : 24; // Use config or default

				if (hoursSinceAnalysis < cacheDurationHours) {
					displayCategories(result.claudeCategories);
					console.log(
						"Loaded cached categories from",
						Math.round(hoursSinceAnalysis),
						"hours ago"
					);
				} else {
					categoriesList.innerHTML =
						'<div class="empty-state">Previous analysis is outdated. Click "Analyze + Smart Cache" for fresh results.</div>';
				}
			}
		} catch (error) {
			console.error("Error loading cached categories:", error);
		}
	}
});
