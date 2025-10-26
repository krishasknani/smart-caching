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
    // Remove scripts
    doc.querySelectorAll("script").forEach((el) => el.remove());
    // Remove inline handlers
    doc.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((a) => {
        if (a.name.startsWith("on")) el.removeAttribute(a.name);
      });
    });

    // Add degraded quality banner for fallback HTML
    const degradedBanner = doc.createElement("div");
    degradedBanner.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			background: #ff9800;
			color: white;
			padding: 10px;
			text-align: center;
			z-index: 999999;
			font-family: Arial, sans-serif;
			font-size: 14px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.2);
		`;
    degradedBanner.innerHTML = `
			⚠️ Degraded Viewing Quality - This page has anti-bot protection and is cached with limited functionality
		`;

    // Insert banner at the start of body
    if (doc.body) {
      doc.body.insertBefore(degradedBanner, doc.body.firstChild);

      // Add spacer so content isn't hidden under banner
      const spacer = doc.createElement("div");
      spacer.style.height = "50px";
      doc.body.insertBefore(spacer, degradedBanner.nextSibling);
    }

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
