chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
	if (msg?.type !== "SCRAPE_URL") return;
	try {
		const res = await fetch(msg.url, {
			redirect: "follow",
			credentials: "omit",
		});
		if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
		const html = await res.text();
		const doc = new DOMParser().parseFromString(html, "text/html");

		doc.querySelectorAll("script").forEach((el) => el.remove());

		doc.querySelectorAll("*").forEach((el) => {
			[...el.attributes].forEach((a) => {
				if (a.name.startsWith("on")) el.removeAttribute(a.name);
			});
		});

		const title = doc.title || msg.url;
		const content = "<!doctype html>\n" + doc.documentElement.outerHTML;
		chrome.runtime.sendMessage({
			type: "SCRAPE_RESULT",
			requestId: msg.requestId,
			title,
			content,
		});
	} catch (e) {
		chrome.runtime.sendMessage({
			type: "SCRAPE_RESULT",
			requestId: msg.requestId,
			error: String(e?.message || e),
		});
	}
});
