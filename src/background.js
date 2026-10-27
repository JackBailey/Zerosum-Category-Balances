const api = globalThis.browser ?? globalThis.chrome;
const API_BASE_URL = "https://api.zerosumapp.com/api/v1";

const fetchJson = async path => {
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    return response.json();
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "zcb-open-options") {
        api.tabs.create({ url: api.runtime.getURL("options.html") });
        return undefined;
    }
    if (message?.type !== "zcb-load-budget-data") return undefined;

    Promise.all([
        fetchJson(`/budgets/${encodeURIComponent(message.budgetId)}/accounts`),
        fetchJson(`/budgets/${encodeURIComponent(message.budgetId)}/meta`),
        fetchJson(`/budgets/${encodeURIComponent(message.budgetId)}/data`).catch(() => null),
    ])
        .then(([accounts, meta, budget]) => sendResponse({ ok: true, accounts, meta, budget }))
        .catch(error => sendResponse({ ok: false, error: error.message }));

    return true;
});
