const api = globalThis.browser ?? globalThis.chrome;
const API_BASE_URL = "https://api.zerosumapp.com/api/v1";

const fetchJson = async path => {
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    return response.json();
};

const parseGistUrl = url => {
    const raw = url.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/raw(?:\/[^/]*)?/i);
    if (raw) return { baseUrl: raw[1], id: raw[3] };
    const github = url.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)/i);
    if (github) return { baseUrl: "https://api.github.com", id: github[2], github: true };
    throw new Error("Unsupported Gist URL");
};

const fetchCloudConfig = async (url, token) => {
    const match = url.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)/i);
    const rawUrl = match ? `https://gist.githubusercontent.com/${match[1]}/${match[2]}/raw` : url;
    const response = await fetch(rawUrl, token ? { headers: { Authorization: `Token ${token}` } } : undefined);
    if (!response.ok) throw new Error(`Gist request failed: ${response.status}`);
    return response.json();
};

const updateCloudConfig = async (url, token, config, gistId, fileName = "config.json") => {
    const gist = parseGistUrl(url);
    if (gist.github || !gistId) throw new Error("OpenGist gist details are required for saving");
    const response = await fetch(`${gist.baseUrl}/api/gists/${encodeURIComponent(gistId)}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            description: `ZCB: Config Change ${new Date().toISOString()}`,
            files: { [fileName]: { content: JSON.stringify(config, null, 2) } },
        }),
    });
    if (!response.ok) throw new Error(`Gist update failed: ${response.status}`);
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "zcb-open-options") {
        api.tabs.create({ url: api.runtime.getURL("options.html") });
        return undefined;
    }
    if (message?.type === "zcb-load-cloud-config") {
        fetchCloudConfig(message.url, message.token)
            .then(config => sendResponse({ ok: true, config }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (message?.type === "zcb-update-cloud-config") {
        updateCloudConfig(message.url, message.token, message.config, message.gistId, message.fileName)
            .then(() => sendResponse({ ok: true }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
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
