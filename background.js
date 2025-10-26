// Background service worker
chrome.runtime.onInstalled.addListener(() => {
	console.log("Smart Caching Extension installed");
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
