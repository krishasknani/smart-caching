document.addEventListener("DOMContentLoaded", function () {
	const cacheButton = document.getElementById("cacheButton");
	const analyzeButton = document.getElementById("analyzeButton");
	const smartCacheButton = document.getElementById("smartCacheButton");
	const autoCacheToggle = document.getElementById("autoCacheToggle");
	const cachedPagesList = document.getElementById("cachedPagesList");
	const categoriesList = document.getElementById("categoriesList");
	const searchInput = document.getElementById("searchInput");
	const searchClear = document.getElementById("searchClear");
	const flightBanner = document.getElementById("flightBanner");

	let allCachedPages = [];

	if (searchInput) {
		searchInput.addEventListener("input", function () {
			const query = this.value.trim();
			filterCachedPages(query);

			if (searchClear) {
				searchClear.classList.toggle("visible", query.length > 0);
			}
		});
	}

	if (searchClear) {
		searchClear.addEventListener("click", function () {
			searchInput.value = "";
			searchClear.classList.remove("visible");
			filterCachedPages("");
			searchInput.focus();
		});
	}

	let CONFIG = null;
	loadConfig().then(() => {
		checkServerStatus();
	});

	loadCurrentTab();
	loadCachedPages(true);
	loadCachedCategories();
	loadFlightDetectionStatus();

	updateSmartCacheButton();

	cacheButton.addEventListener("click", function () {
		cacheCurrentPage();
	});

	if (analyzeButton) {
		analyzeButton.addEventListener("click", function () {
			analyzeBrowsingPatterns();
		});
	}

	if (smartCacheButton) {
		smartCacheButton.addEventListener("click", function () {
			runAnalyzeAndSmartCache();
		});
	}

	if (autoCacheToggle) {
		autoCacheToggle.addEventListener("change", function () {
			toggleAutoCaching(this.checked);
		});

		loadAutoCachingPreference();
	}

	async function loadConfig() {
		try {
			const response = await fetch(chrome.runtime.getURL("config.js"));
			const configText = await response.text();
			CONFIG = extractConfigFromText(configText);

			console.log("Configuration loaded successfully in popup");
			return true;
		} catch (error) {
			console.error("Error loading configuration in popup:", error);
			return false;
		}
	}

	function setButtonBusy(btn, label) {
		if (!btn) return;
		btn.classList.add("is-busy");
		btn.disabled = true;
		btn.innerHTML = `<span class="btn-spinner"></span>${escapeHtml(
			label || "Working…"
		)}`;
	}

	function clearButtonBusy(btn, label) {
		if (!btn) return;
		btn.classList.remove("is-busy");
		btn.disabled = false;
		btn.textContent = label || btn.textContent || "Done";
	}

	function renderCachedPagesSkeleton(rows = 3) {
		const items = Array.from({ length: rows })
			.map(
				() => `
			<div class="skeleton-item">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-lines">
					<div class="skeleton-line long"></div>
					<div class="skeleton-line medium"></div>
				</div>
			</div>`
			)
			.join("");
		cachedPagesList.innerHTML = `<div class="list-skeleton">${items}</div>`;
	}

	function renderCategoriesSkeleton(rows = 3) {
		const items = Array.from({ length: rows })
			.map(
				() => `
			<div class="skeleton-item">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-lines">
					<div class="skeleton-line long"></div>
					<div class="skeleton-line medium"></div>
					<div class="skeleton-line short"></div>
				</div>
			</div>`
			)
			.join("");
		categoriesList.innerHTML = `<div class="list-skeleton">${items}</div>`;
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
			if (brightDataTokenMatch)
				config.BRIGHTDATA_TOKEN = brightDataTokenMatch[1];

			const brightDataZoneMatch = configText.match(
				/BRIGHTDATA_ZONE:\s*"([^"]+)"/
			);
			if (brightDataZoneMatch) config.BRIGHTDATA_ZONE = brightDataZoneMatch[1];

			const serpCountMatch = configText.match(
				/SERP_RESULTS_PER_QUERY:\s*(\d+)/
			);
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

	async function checkServerStatus() {
		const serverStatus = document.getElementById("serverStatus");
		const statusIndicator = document.getElementById("statusIndicator");
		const statusText = document.getElementById("statusText");

		if (!CONFIG?.PLAYWRIGHT_ENABLED) {
			serverStatus.style.display = "none";
			return;
		}

		serverStatus.style.display = "flex";
		statusText.textContent = "Checking server...";
		statusIndicator.className = "status-indicator";

		try {
			const response = await fetch(
				`${CONFIG.PLAYWRIGHT_SERVER_URL}/api/health`,
				{
					method: "GET",
					signal: AbortSignal.timeout(3000),
				}
			);

			if (response.ok) {
				statusIndicator.className = "status-indicator online";
				statusText.textContent = "Advanced caching available";
			} else {
				throw new Error("Server not responding");
			}
		} catch (error) {
			statusIndicator.className = "status-indicator offline";
			statusText.textContent = "Using simple caching";
		}
	}

	async function isFirstTimeAnalysis() {
		try {
			const result = await chrome.storage.local.get(["firstAnalysisComplete"]);
			return !result.firstAnalysisComplete;
		} catch (error) {
			console.error("Error checking first-time analysis status:", error);
			return true;
		}
	}

	async function markFirstAnalysisComplete() {
		try {
			await chrome.storage.local.set({ firstAnalysisComplete: true });
			console.log("First analysis marked as complete");
		} catch (error) {
			console.error("Error marking first analysis complete:", error);
		}
	}

	async function updateSmartCacheButton() {
		try {
			if (!smartCacheButton) return;

			const isFirstTime = await isFirstTimeAnalysis();
			if (isFirstTime) {
				smartCacheButton.disabled = false;
				smartCacheButton.textContent = "🧠 Analyze + 🔎 Smart Cache";
			} else {
				smartCacheButton.disabled = true;
				smartCacheButton.textContent =
					"✅ Analysis Complete - Auto-Caching Active";
			}
		} catch (error) {
			console.error("Error updating smart cache button:", error);
		}
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") return;
		if (changes.cachedPages) {
			loadCachedPages();
			loadCurrentTab();
		}
		if (changes.claudeCategories) {
			const cats = changes.claudeCategories.newValue || [];
			if (Array.isArray(cats) && cats.length) {
				displayCategories(cats);
			} else {
				categoriesList.innerHTML =
					'<div class="empty-state">No categories found</div>';
			}
		}
		if (changes.flightDetectionStatus) {
			updateFlightBanner(changes.flightDetectionStatus.newValue);
		}
	});

	async function loadAutoCachingPreference() {
		try {
			if (!autoCacheToggle) return;

			const result = await chrome.storage.local.get(["autoCachingEnabled"]);
			const enabled = result.autoCachingEnabled !== false;
			autoCacheToggle.checked = enabled;
		} catch (error) {
			console.error("Error loading auto-caching preference:", error);
		}
	}

	async function toggleAutoCaching(enabled) {
		try {
			await chrome.storage.local.set({ autoCachingEnabled: enabled });
			console.log("Auto-caching", enabled ? "enabled" : "disabled");
		} catch (error) {
			console.error("Error toggling auto-caching:", error);
		}
	}

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

	async function runAnalyzeAndSmartCache() {
		try {
			if (smartCacheButton)
				setButtonBusy(smartCacheButton, "Analyzing + caching…");

			if (!CONFIG) await loadConfig();
			const token = (CONFIG?.BRIGHTDATA_TOKEN || "").trim();
			const zone = (CONFIG?.BRIGHTDATA_ZONE || "").trim();
			if (!token || !zone) {
				alert(
					"Missing Bright Data credentials. Please set BRIGHTDATA_TOKEN and BRIGHTDATA_ZONE in config.js."
				);
				return;
			}

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
			await updateSmartCacheButton();
			if (smartCacheButton && !smartCacheButton.disabled) {
				clearButtonBusy(smartCacheButton, "🧠 Analyze + 🔎 Smart Cache");
			}
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
			return true;
		} catch {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					files: ["content.js"],
				});
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
			console.log("🚀 Starting page caching process...");
			setButtonBusy(cacheButton, "Caching…");
			renderCachedPagesSkeleton(2);

			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			console.log("📄 Current tab:", tab.url);

			if (!tab || isRestrictedUrl(tab.url)) {
				console.warn("⚠️ Cannot cache restricted URL:", tab.url);
				alert("Cannot cache this page (restricted URL)");
				return;
			}

			console.log("🔧 Ensuring content script is loaded...");
			await ensureContentScript(tab);
			console.log("✅ Content script ready");

			console.log("📤 Sending cache request to background script...");
			chrome.runtime.sendMessage(
				{
					action: "getPageContent",
					url: tab.url,
					maxDepth: 0,
					forceSimple: false,
				},
				(response) => {
					if (chrome.runtime.lastError) {
						console.error("❌ Runtime error:", chrome.runtime.lastError);
						alert("Failed to cache page: " + chrome.runtime.lastError.message);
						return;
					}

					if (response?.success) {
						const method =
							response.method === "playwright" ? "🎭 Advanced" : "📄 Simple";
						console.log(`✅ Page cached successfully using ${method} caching`);
						console.log("📊 Cache stats:", response.stats);
						alert(`Page cached successfully! (${method} caching)`);
						checkServerStatus();
					} else {
						console.error("❌ Caching failed:", response?.error);
						alert(
							"Failed to cache page: " + (response?.error || "Unknown error")
						);
					}
				}
			);
		} catch (error) {
			console.error("❌ Error caching page:", error);
			alert("Failed to cache page: " + error.message);
		} finally {
			clearButtonBusy(cacheButton, "Cache This Page");
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

	let previousCachedUrls = new Set();

	function filterCachedPages(query) {
		const lowerQuery = query.toLowerCase();
		const filteredPages = allCachedPages.filter((page) => {
			const titleMatch = page.title.toLowerCase().includes(lowerQuery);
			const urlMatch = page.url.toLowerCase().includes(lowerQuery);
			return titleMatch || urlMatch;
		});

		renderFilteredPages(filteredPages, query);
	}

	function renderFilteredPages(pages, query) {
		if (pages.length === 0) {
			if (query) {
				cachedPagesList.innerHTML = `<div class="no-results">No pages match "${escapeHtml(
					query
				)}"</div>`;
			} else {
				cachedPagesList.innerHTML =
					'<div class="empty-state">No pages cached yet</div>';
			}
			return;
		}

		cachedPagesList.innerHTML = pages
			.map((page) => {
				const icon = getPageIcon(page.url);
				return `
				<div class="cached-page" data-url="${escapeHtml(page.url)}">
					<div class="page-info">
						<div class="page-icon">${icon}</div>
						<div>
							<div class="page-title">${escapeHtml(page.title)}</div>
							<div class="page-url">${escapeHtml(page.url)}</div>
						</div>
					</div>
					<div class="page-actions">
						<button class="view-button" data-url="${escapeHtml(page.url)}">👁️ View</button>
						<button class="delete-button" data-url="${escapeHtml(
							page.url
						)}">🗑️ Delete</button>
					</div>
				</div>
			`;
			})
			.join("");

		attachPageActionListeners();
	}

	function attachPageActionListeners() {
		document.querySelectorAll(".view-button").forEach((btn) => {
			btn.addEventListener("click", function () {
				viewCachedPage(this.dataset.url);
			});
		});

		document.querySelectorAll(".delete-button").forEach((btn) => {
			btn.addEventListener("click", function () {
				deleteCachedPage(this.dataset.url);
			});
		});
	}

	async function loadCachedPages(skipAnimation = false) {
		try {
			const cachedPages = await getCachedPages();

			allCachedPages = [...cachedPages].reverse();

			if (cachedPages.length === 0) {
				cachedPagesList.innerHTML =
					'<div class="empty-state">No pages cached yet</div>';
				previousCachedUrls.clear();
				return;
			}

			const currentSearch = searchInput ? searchInput.value.trim() : "";
			if (currentSearch) {
				filterCachedPages(currentSearch);
				return;
			}

			const currentUrls = new Set(allCachedPages.map((p) => p.url));
			const newUrls = skipAnimation
				? new Set()
				: new Set(
						[...currentUrls].filter((url) => !previousCachedUrls.has(url))
				  );

			const existingElements = new Map();
			cachedPagesList.querySelectorAll(".cached-page").forEach((el) => {
				const url = el.querySelector(".view-button")?.dataset.url;
				if (url && currentUrls.has(url)) {
					existingElements.set(url, el);
				}
			});

			cachedPagesList.innerHTML = "";

			allCachedPages.forEach((page, index) => {
				let pageElement = existingElements.get(page.url);
				const isNew = newUrls.has(page.url);

				if (!pageElement) {
					pageElement = document.createElement("div");
					pageElement.className = "cached-page";
					const icon = getPageIcon(page.url);
					pageElement.innerHTML = `
						<div class="page-icon">${icon}</div>
						<div class="page-info">
							<div class="page-title">${escapeHtml(page.title)}</div>
							<div class="page-url">${escapeHtml(page.url)}</div>
						</div>
						<div class="page-actions">
							<button class="view-button" data-url="${escapeHtml(page.url)}">View</button>
							<button class="delete-button" data-url="${escapeHtml(page.url)}">Delete</button>
						</div>
					`;

					const viewButton = pageElement.querySelector(".view-button");
					const deleteButton = pageElement.querySelector(".delete-button");

					viewButton.addEventListener("click", () => viewCachedPage(page.url));
					deleteButton.addEventListener("click", () =>
						deleteCachedPage(page.url)
					);

					if (isNew) {
						pageElement.classList.add("fade-in");
					}
				}

				cachedPagesList.appendChild(pageElement);
			});

			previousCachedUrls = currentUrls;
		} catch (error) {
			console.error("Error loading cached pages:", error);
		}
	}

	function getPageIcon(url) {
		try {
			const urlObj = new URL(url);
			const domain = urlObj.hostname.toLowerCase();

			// Map common domains to emojis
			if (domain.includes("github")) return "🐙";
			if (domain.includes("youtube")) return "▶️";
			if (domain.includes("twitter") || domain.includes("x.com")) return "🐦";
			if (domain.includes("reddit")) return "🤖";
			if (domain.includes("wikipedia")) return "📚";
			if (domain.includes("linkedin")) return "💼";
			if (domain.includes("stackoverflow")) return "💬";
			if (domain.includes("medium")) return "📝";
			if (
				domain.includes("news") ||
				domain.includes("bbc") ||
				domain.includes("cnn")
			)
				return "📰";
			if (domain.includes("amazon")) return "🛒";
			if (domain.includes("google")) return "🔍";
			if (domain.includes("facebook")) return "👥";
			if (domain.includes("instagram")) return "📷";
			if (domain.includes("docs.") || domain.includes("documentation"))
				return "📖";

			// Default icon
			return "🌐";
		} catch {
			return "🌐";
		}
	}

	async function viewCachedPage(url) {
		try {
			const cachedPages = await getCachedPages();
			const page = cachedPages.find((p) => p.url === url);

			if (page) {
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
			const elements = cachedPagesList.querySelectorAll(".cached-page");
			let elementToRemove = null;

			elements.forEach((el) => {
				const viewButton = el.querySelector(".view-button");
				if (viewButton && viewButton.dataset.url === url) {
					elementToRemove = el;
				}
			});

			if (elementToRemove) {
				elementToRemove.classList.add("fade-out");
				await new Promise((resolve) => setTimeout(resolve, 300));
			}

			const cachedPages = await getCachedPages();
			const filteredPages = cachedPages.filter((p) => p.url !== url);
			await chrome.storage.local.set({ cachedPages: filteredPages });

			previousCachedUrls.delete(url);

			loadCachedPages(true);
		} catch (error) {
			console.error("Error deleting cached page:", error);
		}
	}

	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}

	async function fetchAllBrowserHistory() {
		try {
			console.log("Fetching all browser history...");

			const historyItems = await chrome.history.search({
				text: "",
				maxResults: 1000,
				startTime: 0,
			});

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

	async function fetchAllOpenTabs() {
		try {
			console.log("Fetching all open tabs...");

			const tabs = await chrome.tabs.query({});

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

	async function prepareDataForClaude() {
		try {
			console.log("Preparing data for Claude analysis...");

			const [historyData, tabsData] = await Promise.all([
				fetchAllBrowserHistory(),
				fetchAllOpenTabs(),
			]);

			const limitedHistory = historyData.slice(0, 500);
			const limitedTabs = tabsData.slice(0, 50);

			const dataForClaude = {
				browser_history: limitedHistory,
				current_tabs: limitedTabs,
				timestamp: Date.now(),
				total_history_items: limitedHistory.length,
				total_open_tabs: limitedTabs.length,
			};

			console.log("Data prepared for Claude:", {
				historyItems: limitedHistory.length,
				openTabs: limitedTabs.length,
			});

			return dataForClaude;
		} catch (error) {
			console.error("Error preparing data for Claude:", error);
			return null;
		}
	}

	async function analyzeBrowsingPatterns() {
		try {
			renderCategoriesSkeleton(3);

			const data = await prepareDataForClaude();
			if (!data) {
				throw new Error("Failed to prepare data for analysis");
			}

			const response = await chrome.runtime.sendMessage({
				action: "analyzeWithClaude",
				data: data,
			});

			if (response.success) {
				displayCategories(response.data);
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
			if (analyzeButton) {
				analyzeButton.disabled = false;
				analyzeButton.textContent = "🧠 Analyze Browsing Patterns";
			}
		}
	}

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

	async function loadCachedCategories() {
		try {
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
				const hoursSinceAnalysis =
					(Date.now() - result.claudeAnalysisTimestamp) / (1000 * 60 * 60);
				const cacheDurationHours = CONFIG ? CONFIG.CACHE_DURATION_HOURS : 24;

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

	async function loadFlightDetectionStatus() {
		try {
			const result = await chrome.storage.local.get(["flightDetectionStatus"]);
			if (result.flightDetectionStatus) {
				updateFlightBanner(result.flightDetectionStatus);
			}
		} catch (error) {
			console.error("Error loading flight detection status:", error);
		}
	}

	function updateFlightBanner(status) {
		if (!flightBanner) return;

		if (!status) {
			flightBanner.style.display = "none";
			return;
		}

		// Auto-dismiss completed/failed banners after showing for a while
		if (!status.active && status.completedAt) {
			const elapsed = Date.now() - status.completedAt;
			// Auto-dismiss after 30 seconds
			if (elapsed > 30000) {
				flightBanner.style.display = "none";
				return;
			}
		}

		let bannerClass = "flight-banner";
		let icon = "✈️";
		let title = "";
		let text = "";
		let showSpinner = false;
		let showClose = false;

		switch (status.stage) {
			case "analyzing":
				title = "Flight Detected!";
				text = "Analyzing your browsing patterns...";
				showSpinner = true;
				break;
			case "caching":
				title = "Caching Flight Info";
				text = status.queries
					? `Fetching ${status.queries.length} related pages...`
					: "Fetching related pages...";
				showSpinner = true;
				break;
			case "fallback":
				title = "Using Fallback";
				text = "Caching essential flight pages...";
				showSpinner = true;
				break;
			case "completed":
				bannerClass += " completed";
				icon = "✅";
				title = "Flight Pages Cached!";
				text = status.queries
					? `${status.queries.length} pages ready for offline viewing`
					: "Pages ready for offline viewing";
				showClose = true;
				break;
			case "failed":
				bannerClass += " failed";
				icon = "⚠️";
				title = "Caching Failed";
				text = "Could not cache flight pages. Please try manually.";
				showClose = true;
				break;
			default:
				flightBanner.style.display = "none";
				return;
		}

		// Truncate flight text if too long
		const flightInfo = status.flightText
			? status.flightText.substring(0, 50) +
			  (status.flightText.length > 50 ? "..." : "")
			: "";

		flightBanner.className = bannerClass;
		flightBanner.style.display = "flex";
		flightBanner.innerHTML = `
			<span class="flight-banner-icon">${icon}</span>
			<div class="flight-banner-content">
				<div class="flight-banner-title">${escapeHtml(title)}</div>
				<div class="flight-banner-text">${escapeHtml(text)}</div>
			</div>
			${showSpinner ? '<div class="flight-banner-spinner"></div>' : ""}
			${
				showClose
					? '<button class="flight-banner-close" id="closeBanner">×</button>'
					: ""
			}
		`;

		// Add close button handler
		if (showClose) {
			const closeBtn = document.getElementById("closeBanner");
			if (closeBtn) {
				closeBtn.addEventListener("click", () => {
					flightBanner.style.display = "none";
					// Clear the status
					chrome.storage.local.remove(["flightDetectionStatus"]);
				});
			}
		}
	}
});
