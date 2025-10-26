if (!window.__smartCachingContentScriptLoaded) {
	window.__smartCachingContentScriptLoaded = true;

	chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		if (request.action === "ping") {
			sendResponse({ ok: true });
			return true;
		}

		if (request.action === "getPageContent") {
			try {
				const content = document.documentElement.outerHTML;
				const cleanContent = cleanPageContent(content);
				sendResponse({ content: cleanContent });
			} catch (error) {
				console.error("Error getting page content:", error);
				sendResponse({ error: "Failed to get page content" });
			}
			return true;
		}

		return false;
	});

	function cleanPageContent(content) {
		const tempDiv = document.createElement("div");
		tempDiv.innerHTML = content;

		const scripts = tempDiv.querySelectorAll("script");
		scripts.forEach((script) => script.remove());

		const allElements = tempDiv.querySelectorAll("*");
		allElements.forEach((element) => {
			const eventAttributes = [
				"onclick",
				"onload",
				"onmouseover",
				"onmouseout",
				"onchange",
				"onsubmit",
			];
			eventAttributes.forEach((attr) => element.removeAttribute(attr));
		});

		const body = tempDiv.querySelector("body");
		if (body) {
			const cacheNote = document.createElement("div");
			cacheNote.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        background-color: #4285f4; color: white;
        padding: 8px; text-align: center; font-size: 14px; z-index: 10000;
      `;
			cacheNote.textContent = "📱 Cached Content - Viewing Offline";
			body.insertBefore(cacheNote, body.firstChild);
		}

		return tempDiv.innerHTML;
	}
}
