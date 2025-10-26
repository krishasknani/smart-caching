document.addEventListener("DOMContentLoaded", function () {
	const cacheButton = document.getElementById("cacheButton");
	const cachedPagesList = document.getElementById("cachedPagesList");

	// Get current tab info and load cached pages
	loadCurrentTab();
	loadCachedPages();

	// Cache button click handler
	cacheButton.addEventListener("click", function () {
		cacheCurrentPage();
	});

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
});
