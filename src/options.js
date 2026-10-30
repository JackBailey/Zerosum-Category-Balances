const API_BASE_URL = "https://api.zerosumapp.com/api/v1";
const extensionApi = globalThis.browser ?? globalThis.chrome;
const STORAGE_KEYS = {
    groups: "accountGroups",
    budget: "selectedBudget",
    defaultGroup: "defaultAccountGroup",
    assignments: "accountGroupAssignments",
    gistUrl: "cloudGistUrl",
    gistToken: "cloudGistToken",
    gistMode: "cloudGistMode",
    gistId: "cloudGistId",
    gistFile: "cloudGistFile",
    gistBaseUrl: "cloudGistBaseUrl",
};
let readOnly = false;
let cloudConfigLoaded = false;
let cloudSaveTimer;

const elements = {
    accounts: document.getElementById("accounts"),
    accountGroups: document.getElementById("account-groups"),
    budget: document.getElementById("budget-id"),
    categories: document.getElementById("categories"),
    createGroup: document.getElementById("create-group"),
    defaultGroup: document.getElementById("default-group"),
    copyConfig: document.getElementById("copy-config"),
    gistRawUrl: document.getElementById("gist-raw-url"),
    loadRawGist: document.getElementById("load-raw-gist"),
    opengistUrl: document.getElementById("opengist-url"),
    opengistToken: document.getElementById("opengist-token"),
    loadOpengistGists: document.getElementById("load-opengist-gists"),
    opengistGist: document.getElementById("opengist-gist"),
    opengistFile: document.getElementById("opengist-file"),
    useOpengist: document.getElementById("use-opengist"),
    configStatus: document.getElementById("config-status"),
};

let current = {
    budgetId: null,
    accounts: [],
    categories: [],
    apiAccountGroups: [],
};
const setReadOnly = (value) => {
    readOnly = value;
    elements.createGroup.disabled = value;
    elements.defaultGroup.disabled = value;
    elements.budget.disabled = value;
};

const createUuidV7 = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const timestamp = BigInt(Date.now());
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = Number(timestamp >> BigInt((5 - index) * 8)) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const isUuidV7 = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value || "",
    );

const mirrorStorage = (key, value) =>
    extensionApi?.storage.local.set({ [key]: value });
const markCloudDirty = () => {
    if (!cloudConfigLoaded) return;
    elements.configStatus.textContent = "Unsaved changes…";
    clearTimeout(cloudSaveTimer);
    if (localStorage.getItem(STORAGE_KEYS.gistMode) !== "opengist") {
        elements.configStatus.textContent =
            "Unsaved changes. Copy JSON to update the raw Gist.";
        return;
    }
    const token = localStorage.getItem(STORAGE_KEYS.gistToken) || "";
    if (!token) {
        elements.configStatus.textContent =
            "Unsaved changes. Add an OpenGist token to save automatically.";
        return;
    }
    cloudSaveTimer = setTimeout(async () => {
        elements.configStatus.textContent = "Saving…";
        const result = await extensionApi.runtime.sendMessage({
            type: "zcb-update-cloud-config",
            url: localStorage.getItem(STORAGE_KEYS.gistUrl) || "",
            token,
            gistId: localStorage.getItem(STORAGE_KEYS.gistId) || "",
            fileName:
                localStorage.getItem(STORAGE_KEYS.gistFile) || "config.json",
            config: getConfig(),
        });
        elements.configStatus.textContent = result?.ok
            ? "Saved to Gist."
            : `Save failed: ${result?.error || "Unknown error"}`;
    }, 2000);
};

const setCloudStorage = ({
    mode,
    url,
    token,
    gistId = "",
    fileName = "",
    baseUrl = "",
}) => {
    const values = {
        [STORAGE_KEYS.gistMode]: mode,
        [STORAGE_KEYS.gistUrl]: url,
        [STORAGE_KEYS.gistToken]: token,
        [STORAGE_KEYS.gistId]: gistId,
        [STORAGE_KEYS.gistFile]: fileName,
        [STORAGE_KEYS.gistBaseUrl]: baseUrl,
    };
    for (const [key, value] of Object.entries(values)) {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
        mirrorStorage(key, value || null);
    }
};

const getConfig = () => ({
    accountGroups: groups.list(),
    defaultAccountGroup: localStorage.getItem(STORAGE_KEYS.defaultGroup),
    accountGroupAssignments: JSON.parse(
        localStorage.getItem(STORAGE_KEYS.assignments) || "{}",
    ),
});

const gistRawUrl = (url) => {
    const match = url.match(
        /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)/i,
    );
    return match
        ? `https://gist.githubusercontent.com/${match[1]}/${match[2]}/raw`
        : url;
};

const applyConfig = (config) => {
    const groupIdMap = new Map();
    const accountGroups = (config.accountGroups ?? []).map((group) => {
        const id = isUuidV7(group.id) ? group.id : createUuidV7();
        if (id !== group.id) groupIdMap.set(group.id, id);
        return { ...group, id };
    });
    const assignments = JSON.parse(
        JSON.stringify(config.accountGroupAssignments ?? {}),
    );
    for (const budget of Object.values(assignments)) {
        for (const kind of ["accounts", "categories", "categoryGroups"]) {
            for (const [itemId, groupId] of Object.entries(
                budget[kind] ?? {},
            )) {
                if (groupId && groupIdMap.has(groupId))
                    budget[kind][itemId] = groupIdMap.get(groupId);
            }
        }
    }
    const defaultGroup =
        groupIdMap.get(config.defaultAccountGroup) ??
        config.defaultAccountGroup;
    localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(accountGroups));
    localStorage.setItem(STORAGE_KEYS.defaultGroup, defaultGroup || "");
    localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(assignments));
    mirrorStorage("accountGroups", accountGroups);
    mirrorStorage("defaultAccountGroup", defaultGroup || null);
    mirrorStorage("accountGroupAssignments", assignments);
};

const pullGist = async (url, token = "") => {
    const response = await fetch(
        gistRawUrl(url),
        token ? { headers: { Authorization: `Token ${token}` } } : undefined,
    );
    if (!response.ok)
        throw new Error(`Gist request failed: ${response.status}`);
    const config = await response.json();
    applyConfig(config);
    return config;
};

let opengistGists = [];
let opengistDetails = new Map();

const getOpengistBaseUrl = () => {
    const value = elements.opengistUrl.value.trim().replace(/\/$/, "");
    if (!value) throw new Error("Enter an OpenGist URL first");
    try {
        const url = new URL(value);
        if (url.protocol !== "https:")
            throw new Error("OpenGist must use HTTPS");
        return url.origin;
    } catch (error) {
        throw new Error(
            error.message === "OpenGist must use HTTPS"
                ? error.message
                : "Enter a valid OpenGist URL",
        );
    }
};

const ensureOpengistHostPermission = async (baseUrl) => {
    const origin = `${new URL(baseUrl).origin}/*`;
    const permissions = { origins: [origin] };
    if (await extensionApi.permissions.contains(permissions)) return true;
    return extensionApi.permissions.request(permissions);
};

const opengistFetch = async (baseUrl, path, token) => {
    const response = await fetch(`${baseUrl}/api${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
        throw new Error(
            `OpenGist request failed: ${response.status} ${response.statusText}`,
        );
    return response.json();
};

const opengistRawUrl = (baseUrl, gist, fileName) => {
    const owner = gist.owner?.username || gist.owner?.login;
    if (!owner || !gist.id)
        throw new Error("Selected OpenGist is missing its owner or ID");
    return `${baseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(gist.id)}/raw/HEAD/${encodeURIComponent(fileName)}`;
};

const renderOpengistFiles = () => {
    const gist = opengistDetails.get(elements.opengistGist.value);
    elements.opengistFile.replaceChildren();
    if (!gist) {
        elements.opengistFile.disabled = true;
        elements.opengistFile.append(new Option("Select a Gist first", ""));
        elements.useOpengist.disabled = true;
        return;
    }
    const files = Object.values(gist.files ?? {});
    if (!files.length) {
        elements.opengistFile.disabled = true;
        elements.opengistFile.append(new Option("No files found", ""));
        elements.useOpengist.disabled = true;
        return;
    }
    elements.opengistFile.disabled = false;
    for (const file of files)
        elements.opengistFile.append(
            new Option(file.filename || file.name, file.filename || file.name),
        );
    elements.useOpengist.disabled = false;
};

const loadOpengistGists = async () => {
    let baseUrl;
    try {
        baseUrl = getOpengistBaseUrl();
    } catch (error) {
        elements.configStatus.textContent = error.message;
        return;
    }
    const token = elements.opengistToken.value.trim();
    if (!token) {
        elements.configStatus.textContent =
            "Enter an OpenGist access token first.";
        return;
    }
    try {
        if (!(await ensureOpengistHostPermission(baseUrl))) {
            elements.configStatus.textContent =
                "Permission to access this OpenGist server was denied.";
            return;
        }
    } catch (error) {
        elements.configStatus.textContent = `Unable to request OpenGist access: ${error.message}`;
        return;
    }
    elements.loadOpengistGists.disabled = true;
    elements.configStatus.textContent = "Loading OpenGist gists…";
    try {
        opengistGists = await opengistFetch(
            baseUrl,
            "/gists?per_page=100",
            token,
        );
        opengistDetails = new Map();
        elements.opengistGist.replaceChildren();
        if (!opengistGists.length) {
            elements.opengistGist.append(new Option("No gists found", ""));
            elements.opengistGist.disabled = true;
            renderOpengistFiles();
        } else {
            elements.opengistGist.disabled = false;
            for (const gist of opengistGists) {
                const label =
                    gist.title || gist.description || gist.slug_url || gist.id;
                elements.opengistGist.append(new Option(label, gist.id));
            }
            elements.opengistGist.value = opengistGists[0].id;
            const detail = await opengistFetch(
                baseUrl,
                `/gists/${encodeURIComponent(elements.opengistGist.value)}`,
                token,
            );
            opengistDetails.set(detail.id, detail);
            renderOpengistFiles();
        }
        elements.configStatus.textContent = "Select an OpenGist file to use.";
    } catch (error) {
        elements.configStatus.textContent = `Unable to load OpenGist: ${error.message}`;
    } finally {
        elements.loadOpengistGists.disabled = false;
    }
};

const fetchJson = async (path) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        credentials: "include",
    });
    if (!response.ok)
        throw new Error(
            `Request failed: ${response.status} ${response.statusText}`,
        );
    return response.json();
};

const findArray = (payload, names) => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return null;
    for (const name of names) {
        if (Array.isArray(payload[name])) return payload[name];
    }
    for (const value of Object.values(payload)) {
        const result = findArray(value, names);
        if (result) return result;
    }
    return null;
};

const ZSBudgets = {
    list: async () => findArray(await fetchJson("/budgets"), ["budgets"]) ?? [],
};

const ZSAccounts = {
    list: async (budgetId) => {
        const payload = await fetchJson(
            `/budgets/${encodeURIComponent(budgetId)}/accounts`,
        );
        return {
            bankAccounts: findArray(payload, ["bankAccounts"]) ?? [],
            loanAccounts: findArray(payload, ["loanAccounts"]) ?? [],
        };
    },
};

const ZSAccountGroups = {
    list: async (budgetId) => {
        const payload = await fetchJson(
            `/budgets/${encodeURIComponent(budgetId)}/account-groups`,
        );
        return Array.isArray(payload)
            ? payload
            : (findArray(payload, ["accountGroups"]) ?? []);
    },
};

const ZSCategories = {
    list: async (budgetId) => {
        const payload = await fetchJson(
            `/budgets/${encodeURIComponent(budgetId)}/meta`,
        );
        const categories = findArray(payload, ["categories"]) ?? [];
        const categoryGroups = (
            findArray(payload, ["categoryGroups"]) ?? []
        ).filter(
            (group) =>
                group.isHidden === false &&
                group.systemType !== "CREDIT_CARD_PAYMENTS",
        );
        const groupsById = new Map(
            categoryGroups.map((group) => [group.id, group]),
        );

        const normalisedCategories = categories
            .flatMap((item) =>
                Array.isArray(item.categories) ? item.categories : [item],
            )
            .map((category) => ({
                ...category,
                id: category.id ?? category.categoryId,
                name: category.name ?? category.categoryName,
                groupId: category.categoryGroupId ?? category.groupId,
            }))
            .filter(
                (category) =>
                    category.id &&
                    category.isHidden === false &&
                    (!category.groupId || groupsById.has(category.groupId)),
            )
            .map((category) => ({
                ...category,
                group: groupsById.get(category.groupId),
            }))
            .sort((left, right) => {
                const groupOrder =
                    (left.group?.order ?? Infinity) -
                    (right.group?.order ?? Infinity);
                return (
                    groupOrder ||
                    (left.order ?? Infinity) - (right.order ?? Infinity)
                );
            });

        return normalisedCategories;
    },
};

const groups = {
    list() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.groups)) ?? [];
        } catch {
            return [];
        }
    },
    save(value) {
        localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(value));
        mirrorStorage("accountGroups", value);
        markCloudDirty();
    },
    create() {
        this.save([...this.list(), { id: createUuidV7(), name: "" }]);
    },
    update(group) {
        this.save(
            this.list().map((item) => (item.id === group.id ? group : item)),
        );
    },
    remove(id) {
        this.save(this.list().filter((group) => group.id !== id));
    },
    move(id, offset) {
        const value = this.list();
        const index = value.findIndex((group) => group.id === id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= value.length) return;
        [value[index], value[target]] = [value[target], value[index]];
        this.save(value);
    },
};

const assignmentState = () => {
    try {
        const all =
            JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments)) ?? {};
        return (
            all[current.budgetId] ?? {
                accounts: {},
                categories: {},
                categoryGroups: {},
            }
        );
    } catch {
        return { accounts: {}, categories: {}, categoryGroups: {} };
    }
};

const saveAssignment = (kind, itemId, groupId) => {
    const all = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.assignments) || "{}",
    );
    const state = all[current.budgetId] ?? {
        accounts: {},
        categories: {},
        categoryGroups: {},
    };
    state[kind] ??= {};
    state[kind][itemId] = groupId;
    all[current.budgetId] = state;
    localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(all));
    mirrorStorage("accountGroupAssignments", all);
    markCloudDirty();
};

const removeAssignment = (kind, itemId) => {
    const all = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.assignments) || "{}",
    );
    const state = all[current.budgetId];
    if (!state?.[kind]) return;
    delete state[kind][itemId];
    all[current.budgetId] = state;
    localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(all));
    mirrorStorage("accountGroupAssignments", all);
    markCloudDirty();
};

const message = (container, text) => {
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    container.append(paragraph);
};

const renderGroups = () => {
    elements.accountGroups.replaceChildren();
    const selectedDefault =
        localStorage.getItem(STORAGE_KEYS.defaultGroup) || "";
    elements.defaultGroup.replaceChildren();
    const noDefault = document.createElement("option");
    noDefault.value = "";
    noDefault.textContent = "None";
    elements.defaultGroup.append(noDefault);
    for (const group of groups.list()) {
        const row = document.createElement("div");
        row.className = "account-group";
        const label = document.createElement("label");
        label.textContent = "Group name";
        const input = document.createElement("input");
        input.value = group.name;
        input.readOnly = readOnly;
        input.addEventListener("input", (event) =>
            groups.update({ ...group, name: event.target.value }),
        );
        const remove = document.createElement("button");
        remove.type = "button";
        remove.disabled = readOnly;
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
            groups.remove(group.id);
            renderGroups();
            renderTables();
        });
        const moveUp = document.createElement("button");
        moveUp.type = "button";
        moveUp.disabled = readOnly;
        moveUp.textContent = "↑";
        moveUp.title = "Move group up";
        moveUp.addEventListener("click", () => {
            groups.move(group.id, -1);
            renderGroups();
            renderTables();
        });
        const moveDown = document.createElement("button");
        moveDown.type = "button";
        moveDown.disabled = readOnly;
        moveDown.textContent = "↓";
        moveDown.title = "Move group down";
        moveDown.addEventListener("click", () => {
            groups.move(group.id, 1);
            renderGroups();
            renderTables();
        });
        label.append(input);
        row.append(label, moveUp, moveDown, remove);
        elements.accountGroups.append(row);

        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name || "Unnamed group";
        elements.defaultGroup.append(option);
    }
    elements.defaultGroup.value = groups
        .list()
        .some((group) => group.id === selectedDefault)
        ? selectedDefault
        : "";
};

const renderTable = (container, title, rows, kind) => {
    container.replaceChildren();
    const groupList = groups.list();
    const defaultGroupId = localStorage.getItem(STORAGE_KEYS.defaultGroup);
    if (!rows.length) {
        message(container, `No ${title.toLowerCase()} found.`);
        return;
    }
    if (!groupList.length) {
        message(container, "Create an account group first.");
        return;
    }

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "assignment-table";
    const head = document.createElement("tr");
    const nameHead = document.createElement("th");
    nameHead.textContent = title;
    head.append(nameHead);
    for (const group of groupList) {
        const cell = document.createElement("th");
        cell.textContent = group.name || "Unnamed group";
        head.append(cell);
    }
    const thead = document.createElement("thead");
    thead.append(head);
    table.append(thead);

    const body = document.createElement("tbody");
    const state = assignmentState();
    state[kind] ??= {};
    let previousGroupId;
    for (const row of rows) {
        if (kind === "categories" && row.group?.id !== previousGroupId) {
            const groupRow = document.createElement("tr");
            groupRow.className = "category-group-row";
            const groupCell = document.createElement("th");
            groupCell.textContent = row.group?.name || "Ungrouped";
            groupRow.append(groupCell);
            if (row.group?.id) {
                const hasGroupAssignment = Object.prototype.hasOwnProperty.call(
                    state.categoryGroups ?? {},
                    row.group.id,
                );
                const groupAssignment = hasGroupAssignment
                    ? state.categoryGroups[row.group.id]
                    : defaultGroupId;
                for (const group of groupList) {
                    const cell = document.createElement("td");
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.disabled = readOnly;
                    checkbox.checked = groupAssignment === group.id;
                    checkbox.setAttribute(
                        "aria-label",
                        `${row.group.name}: ${group.name || "Unnamed group"}`,
                    );
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked)
                            saveAssignment(
                                "categoryGroups",
                                row.group.id,
                                group.id,
                            );
                        else if (hasGroupAssignment)
                            removeAssignment("categoryGroups", row.group.id);
                        else
                            saveAssignment(
                                "categoryGroups",
                                row.group.id,
                                null,
                            );
                        renderTables();
                    });
                    cell.append(checkbox);
                    groupRow.append(cell);
                }
            } else {
                groupCell.colSpan = groupList.length + 1;
            }
            body.append(groupRow);
            previousGroupId = row.group?.id;
        }
        const tr = document.createElement("tr");
        const hasOverride =
            kind === "categories" &&
            Object.prototype.hasOwnProperty.call(state.categories, row.id);
        const inheritedGroupId =
            kind === "categories" && !hasOverride
                ? Object.prototype.hasOwnProperty.call(
                      state.categoryGroups ?? {},
                      row.group?.id,
                  )
                    ? state.categoryGroups[row.group?.id]
                    : defaultGroupId
                : null;
        if (inheritedGroupId) tr.classList.add("inherited-assignment");
        const name = document.createElement("td");
        name.textContent = row.name || "Unnamed";
        tr.append(name);
        for (const group of groupList) {
            const cell = document.createElement("td");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.disabled = readOnly;
            const hasAssignment = Object.prototype.hasOwnProperty.call(
                state[kind],
                row.id,
            );
            const assignedGroupId =
                kind === "categories"
                    ? hasOverride
                        ? state.categories[row.id]
                        : inheritedGroupId
                    : hasAssignment
                      ? state[kind][row.id]
                      : defaultGroupId;
            checkbox.checked = assignedGroupId === group.id;
            checkbox.setAttribute(
                "aria-label",
                `${row.name || "Unnamed"}: ${group.name || "Unnamed group"}`,
            );
            checkbox.addEventListener("change", () => {
                if (!checkbox.checked && kind === "categories" && hasOverride) {
                    removeAssignment(kind, row.id);
                } else {
                    saveAssignment(
                        kind,
                        row.id,
                        checkbox.checked ? group.id : null,
                    );
                }
                renderTables();
            });
            cell.append(checkbox);
            tr.append(cell);
        }
        body.append(tr);
    }
    table.append(body);
    scroll.append(table);
    container.append(scroll);
};

const renderTables = () => {
    renderTable(elements.accounts, "Account", current.accounts, "accounts");
    renderTable(
        elements.categories,
        "Category",
        current.categories,
        "categories",
    );
};

const loadBudget = async (budgetId) => {
    current.budgetId = budgetId;
    localStorage.setItem(STORAGE_KEYS.budget, budgetId);
    message(elements.accounts, "Loading accounts…");
    message(elements.categories, "Loading categories…");
    try {
        const [accountData, accountGroups, categories] = await Promise.all([
            ZSAccounts.list(budgetId),
            ZSAccountGroups.list(budgetId),
            ZSCategories.list(budgetId),
        ]);
        current.apiAccountGroups = accountGroups.sort(
            (left, right) =>
                Number(left.order ?? Infinity) -
                Number(right.order ?? Infinity),
        );
        renderGroups();
        const accountGroupOrder = new Map(
            current.apiAccountGroups.map((group, index) => [group.id, index]),
        );
        current.accounts = [
            ...accountData.bankAccounts,
            ...accountData.loanAccounts,
        ]
            .filter(
                (account) =>
                    ["budget", "credit_card"].includes(
                        String(account.type).toLowerCase(),
                    ) && account.closed === false,
            )
            .sort((left, right) => {
                const leftType = left.type === "credit_card" ? 0 : 1;
                const rightType = right.type === "credit_card" ? 0 : 1;
                const leftGroup =
                    accountGroupOrder.get(left.accountGroupId) ?? -1;
                const rightGroup =
                    accountGroupOrder.get(right.accountGroupId) ?? -1;
                return (
                    leftType - rightType ||
                    leftGroup - rightGroup ||
                    Number(left.order ?? Infinity) -
                        Number(right.order ?? Infinity)
                );
            });
        mirrorStorage("accounts", current.accounts);
        current.categories = categories;
        mirrorStorage("selectedBudget", budgetId);
        mirrorStorage("categories", current.categories);
        const categoryGroups = [
            ...new Map(
                categories
                    .filter((category) => category.group?.id)
                    .map((category) => [
                        category.group.id,
                        { id: category.group.id, name: category.group.name },
                    ]),
            ).values(),
        ];
        mirrorStorage("categoryGroups", categoryGroups);
        renderTables();
    } catch (error) {
        message(elements.accounts, `Unable to load accounts: ${error.message}`);
        message(
            elements.categories,
            `Unable to load categories: ${error.message}`,
        );
    }
};

elements.createGroup.addEventListener("click", () => {
    groups.create();
    renderGroups();
    renderTables();
});
elements.defaultGroup.addEventListener("change", (event) => {
    if (event.target.value)
        localStorage.setItem(STORAGE_KEYS.defaultGroup, event.target.value);
    else localStorage.removeItem(STORAGE_KEYS.defaultGroup);
    mirrorStorage("defaultAccountGroup", event.target.value || null);
    markCloudDirty();
    renderTables();
});
elements.budget.addEventListener("change", (event) =>
    loadBudget(event.target.value),
);
elements.copyConfig.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(getConfig(), null, 2));
    elements.configStatus.textContent =
        "Configuration copied. Replace the Gist contents with this JSON.";
});
elements.loadRawGist.addEventListener("click", async () => {
    const url = elements.gistRawUrl.value.trim();
    if (!url) {
        elements.configStatus.textContent = "Enter a Gist Raw URL first.";
        return;
    }
    try {
        await pullGist(url);
        setCloudStorage({ mode: "raw", url, token: "" });
        setReadOnly(false);
        cloudConfigLoaded = true;
        renderGroups();
        renderTables();
        elements.configStatus.textContent =
            "Loaded from raw Gist. Copy JSON to save changes manually.";
    } catch (error) {
        elements.configStatus.textContent = `Unable to load raw Gist: ${error.message}`;
    }
});

elements.loadOpengistGists.addEventListener("click", loadOpengistGists);
elements.opengistGist.addEventListener("change", async () => {
    let baseUrl;
    try {
        baseUrl = getOpengistBaseUrl();
    } catch (error) {
        elements.configStatus.textContent = error.message;
        return;
    }
    const token = elements.opengistToken.value.trim();
    if (!token || !elements.opengistGist.value) return;
    try {
        const detail = await opengistFetch(
            baseUrl,
            `/gists/${encodeURIComponent(elements.opengistGist.value)}`,
            token,
        );
        opengistDetails.set(detail.id, detail);
        renderOpengistFiles();
    } catch (error) {
        elements.configStatus.textContent = `Unable to load Gist files: ${error.message}`;
    }
});

elements.useOpengist.addEventListener("click", async () => {
    let baseUrl;
    try {
        baseUrl = getOpengistBaseUrl();
    } catch (error) {
        elements.configStatus.textContent = error.message;
        return;
    }
    const token = elements.opengistToken.value.trim();
    const gist = opengistDetails.get(elements.opengistGist.value);
    const fileName = elements.opengistFile.value;
    if (!token || !gist || !fileName) {
        elements.configStatus.textContent = "Select a Gist and file first.";
        return;
    }
    const url = opengistRawUrl(baseUrl, gist, fileName);
    try {
        if (!(await ensureOpengistHostPermission(baseUrl))) {
            elements.configStatus.textContent =
                "Permission to access this OpenGist server was denied.";
            return;
        }
        await pullGist(url, token);
        setCloudStorage({
            mode: "opengist",
            url,
            token,
            gistId: gist.id,
            fileName,
            baseUrl,
        });
        setReadOnly(false);
        cloudConfigLoaded = true;
        renderGroups();
        renderTables();
        elements.configStatus.textContent =
            "Loaded from OpenGist. Changes will save automatically.";
    } catch (error) {
        elements.configStatus.textContent = `Unable to load OpenGist file: ${error.message}`;
    }
});

const initialise = async () => {
    const gistUrl = localStorage.getItem(STORAGE_KEYS.gistUrl) || "";
    const gistToken = localStorage.getItem(STORAGE_KEYS.gistToken) || "";
    const gistBaseUrl = localStorage.getItem(STORAGE_KEYS.gistBaseUrl) || "";
    const gistMode =
        localStorage.getItem(STORAGE_KEYS.gistMode) ||
        (gistToken ? "opengist" : "raw");
    if (gistMode === "raw") elements.gistRawUrl.value = gistUrl;
    if (gistMode === "opengist") {
        elements.opengistUrl.value = gistBaseUrl;
        elements.opengistToken.value = gistToken;
    }
    mirrorStorage(STORAGE_KEYS.gistUrl, gistUrl || null);
    mirrorStorage(STORAGE_KEYS.gistToken, gistToken || null);
    mirrorStorage(STORAGE_KEYS.gistMode, gistMode);
    mirrorStorage(
        STORAGE_KEYS.gistId,
        localStorage.getItem(STORAGE_KEYS.gistId) || null,
    );
    mirrorStorage(
        STORAGE_KEYS.gistFile,
        localStorage.getItem(STORAGE_KEYS.gistFile) || null,
    );
    mirrorStorage(STORAGE_KEYS.gistBaseUrl, gistBaseUrl || null);
    if (gistUrl) {
        try {
            await pullGist(gistUrl, gistToken);
            setReadOnly(false);
            cloudConfigLoaded = true;
            elements.configStatus.textContent =
                gistMode === "opengist"
                    ? "Loaded from OpenGist. Changes will save automatically."
                    : "Loaded from raw Gist. Copy JSON to save changes manually.";
        } catch (error) {
            elements.configStatus.textContent = `Unable to load Gist: ${error.message}`;
        }
    }
    try {
        applyConfig(getConfig());
    } catch (error) {
        console.warn("Unable to migrate config IDs", error);
    }
    renderGroups();
    mirrorStorage("accountGroups", groups.list());
    try {
        mirrorStorage(
            "accountGroupAssignments",
            JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments) || "{}"),
        );
    } catch {
        mirrorStorage("accountGroupAssignments", {});
    }
    mirrorStorage(
        "defaultAccountGroup",
        localStorage.getItem(STORAGE_KEYS.defaultGroup),
    );
    try {
        const budgets = await ZSBudgets.list();
        for (const budget of budgets) {
            const option = document.createElement("option");
            option.value = budget.id;
            option.textContent = budget.name;
            elements.budget.append(option);
        }
        const saved = localStorage.getItem(STORAGE_KEYS.budget);
        const budgetId = budgets.some((budget) => budget.id === saved)
            ? saved
            : budgets[0]?.id;
        if (budgetId) {
            elements.budget.value = budgetId;
            await loadBudget(budgetId);
        } else {
            message(elements.accounts, "No budgets found.");
            message(elements.categories, "No budgets found.");
        }
    } catch (error) {
        message(elements.accounts, `Unable to load budgets: ${error.message}`);
        message(
            elements.categories,
            `Unable to load budgets: ${error.message}`,
        );
    }
};

initialise();
