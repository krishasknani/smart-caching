(function () {
	if (window.__calendarFlightScannerLoaded) return;
	window.__calendarFlightScannerLoaded = true;

	const KEYWORD_REGEXES = [/\bflight\b/i];
	const AIRLINE_CODE_RX = /(?:^|\s)[A-Z]{2}\s?\d{2,4}(?=\b)/;
	const AIRPORT_CODE_RX = /\b[A-Z]{3}\b/;

	const seen = new Set();

	function hashEventLike(s) {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
		return String(h);
	}

	function extractUrls(text) {
		const rx = /\bhttps?:\/\/[^\s)]+/gi;
		return Array.from(new Set(text.match(rx) || []));
	}

	function looksLikeFlight(haystack) {
		if (!haystack) return false;
		if (!KEYWORD_REGEXES.some((rx) => rx.test(haystack))) return false;

		const hasAirlineCode = AIRLINE_CODE_RX.test(haystack);
		const airportCodes = haystack.match(AIRPORT_CODE_RX) || [];
		const hasAirports = airportCodes.length >= 2;
		return hasAirlineCode || hasAirports || true;
	}

	function mineEventStrings(root = document) {
		const candidates = new Set();

		try {
			root.querySelectorAll('[role="button"][data-eventchip]').forEach((el) => {
				const t = (
					el.getAttribute("aria-label") ||
					el.textContent ||
					""
				).trim();
				if (t) candidates.add(t);
			});

			root.querySelectorAll('[role="listitem"], [role="row"]').forEach((el) => {
				const aria = el.getAttribute?.("aria-label");
				const txt = (aria || el.textContent || "").trim();
				if (txt) candidates.add(txt);
			});

			root
				.querySelectorAll('[role="dialog"], [data-dragsource-type="EVENT"]')
				.forEach((el) => {
					const aria = el.getAttribute?.("aria-label");
					const txt = (aria || el.textContent || "").trim();
					if (txt) candidates.add(txt);
				});
		} catch (e) {}

		return Array.from(candidates);
	}

	function scanOnce() {
		const strings = mineEventStrings(document);
		for (const s of strings) {
			if (!looksLikeFlight(s)) continue;
			const id = hashEventLike(s);
			if (seen.has(id)) continue;
			seen.add(id);

			const urls = extractUrls(s);
			chrome.runtime.sendMessage({
				type: "FLIGHT_EVENT_DETECTED",
				payload: {
					text: s,
					urls,
					when: Date.now(),
					pageUrl: location.href,
				},
			});
		}
	}

	let pending = false;
	const observer = new MutationObserver(() => {
		if (pending) return;
		pending = true;
		setTimeout(() => {
			pending = false;
			try {
				scanOnce();
			} catch {}
		}, 250);
	});

	window.addEventListener("load", () => {
		try {
			scanOnce();
		} catch {}
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	});

	try {
		scanOnce();
		setTimeout(() => {
			try {
				scanOnce();
			} catch {}
		}, 400);
	} catch {}

	window.addEventListener("popstate", () => {
		try {
			scanOnce();
		} catch {}
	});

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			try {
				scanOnce();
			} catch {}
		}
	});
})();
