const API_BASE_URL = "https://api.zerosumapp.com/api/v1";
const STORAGE_KEYS = { groups: "accountGroups", budget: "selectedBudget", defaultGroup: "defaultAccountGroup", assignments: "accountGroupAssignments" };

const elements = {
    accounts: document.getElementById("accounts"),
    accountGroups: document.getElementById("account-groups"),
    budget: document.getElementById("budget-id"),
    categories: document.getElementById("categories"),
    createGroup: document.getElementById("create-group"),
    defaultGroup: document.getElementById("default-group"),
};

let current = { budgetId: null, accounts: [], categories: [], apiAccountGroups: [] };

const fetchJson = async path => {
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);
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

const ZSBudgets = { list: async () => findArray(await fetchJson("/budgets"), ["budgets"]) ?? [] };

const ZSAccounts = {
    list: async budgetId => {
        const payload = await fetchJson(`/budgets/${encodeURIComponent(budgetId)}/accounts`);
        return {
            bankAccounts: findArray(payload, ["bankAccounts"]) ?? [],
            loanAccounts: findArray(payload, ["loanAccounts"]) ?? [],
        };
    },
};

const ZSAccountGroups = {
    list: async budgetId => {
        const payload = await fetchJson(`/budgets/${encodeURIComponent(budgetId)}/account-groups`);
        return Array.isArray(payload) ? payload : findArray(payload, ["accountGroups"]) ?? [];
    },
};

const ZSCategories = {
    list: async budgetId => {
        const payload = await fetchJson(`/budgets/${encodeURIComponent(budgetId)}/meta`);
        const categories = findArray(payload, ["categories"]) ?? [];
        const categoryGroups = (findArray(payload, ["categoryGroups"]) ?? [])
            .filter(group => group.isHidden === false && group.systemType !== "CREDIT_CARD_PAYMENTS");
        const groupsById = new Map(categoryGroups.map(group => [group.id, group]));

        const normalisedCategories = categories
            .flatMap(item => Array.isArray(item.categories) ? item.categories : [item])
            .map(category => ({
                ...category,
                id: category.id ?? category.categoryId,
                name: category.name ?? category.categoryName,
                groupId: category.categoryGroupId ?? category.groupId,
            }))
            .filter(category => (
                category.id
                && category.isHidden === false
                && (!category.groupId || groupsById.has(category.groupId))
            ))
            .map(category => ({
                ...category,
                group: groupsById.get(category.groupId),
            }))
            .sort((left, right) => {
                const groupOrder = (left.group?.order ?? Infinity) - (right.group?.order ?? Infinity);
                return groupOrder || ((left.order ?? Infinity) - (right.order ?? Infinity));
            });

        return normalisedCategories;
    },
};

const groups = {
    list() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.groups)) ?? []; } catch { return []; }
    },
    save(value) { localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(value)); },
    create() { this.save([...this.list(), { id: crypto.randomUUID(), name: "" }]); },
    update(group) { this.save(this.list().map(item => item.id === group.id ? group : item)); },
    remove(id) { this.save(this.list().filter(group => group.id !== id)); },
    move(id, offset) {
        const value = this.list();
        const index = value.findIndex(group => group.id === id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= value.length) return;
        [value[index], value[target]] = [value[target], value[index]];
        this.save(value);
    },
};

const assignmentState = () => {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments)) ?? {};
        return all[current.budgetId] ?? { accounts: {}, categories: {}, categoryGroups: {} };
    } catch { return { accounts: {}, categories: {}, categoryGroups: {} }; }
};

const saveAssignment = (kind, itemId, groupId) => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments) || "{}");
    const state = all[current.budgetId] ?? { accounts: {}, categories: {}, categoryGroups: {} };
    state[kind] ??= {};
    state[kind][itemId] = groupId;
    all[current.budgetId] = state;
    localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(all));
};

const removeAssignment = (kind, itemId) => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.assignments) || "{}");
    const state = all[current.budgetId];
    if (!state?.[kind]) return;
    delete state[kind][itemId];
    all[current.budgetId] = state;
    localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(all));
};

const message = (container, text) => {
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    container.append(paragraph);
};

const renderGroups = () => {
    elements.accountGroups.replaceChildren();
    const selectedDefault = localStorage.getItem(STORAGE_KEYS.defaultGroup) || "";
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
        input.addEventListener("input", event => groups.update({ ...group, name: event.target.value }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => { groups.remove(group.id); renderGroups(); renderTables(); });
        const moveUp = document.createElement("button");
        moveUp.type = "button";
        moveUp.textContent = "↑";
        moveUp.title = "Move group up";
        moveUp.addEventListener("click", () => { groups.move(group.id, -1); renderGroups(); renderTables(); });
        const moveDown = document.createElement("button");
        moveDown.type = "button";
        moveDown.textContent = "↓";
        moveDown.title = "Move group down";
        moveDown.addEventListener("click", () => { groups.move(group.id, 1); renderGroups(); renderTables(); });
        label.append(input);
        row.append(label, moveUp, moveDown, remove);
        elements.accountGroups.append(row);

        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name || "Unnamed group";
        elements.defaultGroup.append(option);
    }
    elements.defaultGroup.value = groups.list().some(group => group.id === selectedDefault) ? selectedDefault : "";
};

const renderTable = (container, title, rows, kind) => {
    container.replaceChildren();
    const groupList = groups.list();
    const defaultGroupId = localStorage.getItem(STORAGE_KEYS.defaultGroup);
    if (!rows.length) { message(container, `No ${title.toLowerCase()} found.`); return; }
    if (!groupList.length) { message(container, "Create an account group first."); return; }

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
                const hasGroupAssignment = Object.prototype.hasOwnProperty.call(state.categoryGroups ?? {}, row.group.id);
                const groupAssignment = hasGroupAssignment ? state.categoryGroups[row.group.id] : defaultGroupId;
                for (const group of groupList) {
                    const cell = document.createElement("td");
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = groupAssignment === group.id;
                    checkbox.setAttribute("aria-label", `${row.group.name}: ${group.name || "Unnamed group"}`);
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked) saveAssignment("categoryGroups", row.group.id, group.id);
                        else if (hasGroupAssignment) removeAssignment("categoryGroups", row.group.id);
                        else saveAssignment("categoryGroups", row.group.id, null);
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
        const hasOverride = kind === "categories"
            && Object.prototype.hasOwnProperty.call(state.categories, row.id);
        const inheritedGroupId = kind === "categories" && !hasOverride
            ? (Object.prototype.hasOwnProperty.call(state.categoryGroups ?? {}, row.group?.id)
                ? state.categoryGroups[row.group?.id]
                : defaultGroupId)
            : null;
        if (inheritedGroupId) tr.classList.add("inherited-assignment");
        const name = document.createElement("td");
        name.textContent = row.name || "Unnamed";
        tr.append(name);
        for (const group of groupList) {
            const cell = document.createElement("td");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const hasAssignment = Object.prototype.hasOwnProperty.call(state[kind], row.id);
            const assignedGroupId = kind === "categories"
                ? (hasOverride ? state.categories[row.id] : inheritedGroupId)
                : (hasAssignment ? state[kind][row.id] : defaultGroupId);
            checkbox.checked = assignedGroupId === group.id;
            checkbox.setAttribute("aria-label", `${row.name || "Unnamed"}: ${group.name || "Unnamed group"}`);
            checkbox.addEventListener("change", () => {
                if (!checkbox.checked && kind === "categories" && hasOverride) {
                    removeAssignment(kind, row.id);
                } else {
                    saveAssignment(kind, row.id, checkbox.checked ? group.id : null);
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
    renderTable(elements.categories, "Category", current.categories, "categories");
};

const loadBudget = async budgetId => {
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
        current.apiAccountGroups = accountGroups.sort((left, right) => Number(left.order ?? Infinity) - Number(right.order ?? Infinity));
        renderGroups();
        const accountGroupOrder = new Map(current.apiAccountGroups.map((group, index) => [group.id, index]));
        current.accounts = [...accountData.bankAccounts, ...accountData.loanAccounts]
            .filter(account => ["budget", "credit_card"].includes(String(account.type).toLowerCase()) && account.closed === false)
            .sort((left, right) => {
                const leftType = left.type === "credit_card" ? 0 : 1;
                const rightType = right.type === "credit_card" ? 0 : 1;
                const leftGroup = accountGroupOrder.get(left.accountGroupId) ?? -1;
                const rightGroup = accountGroupOrder.get(right.accountGroupId) ?? -1;
                return leftType - rightType
                    || leftGroup - rightGroup
                    || Number(left.order ?? Infinity) - Number(right.order ?? Infinity);
            });
        current.categories = categories;
        renderTables();
    } catch (error) {
        message(elements.accounts, `Unable to load accounts: ${error.message}`);
        message(elements.categories, `Unable to load categories: ${error.message}`);
    }
};

elements.createGroup.addEventListener("click", () => { groups.create(); renderGroups(); renderTables(); });
elements.defaultGroup.addEventListener("change", event => {
    if (event.target.value) localStorage.setItem(STORAGE_KEYS.defaultGroup, event.target.value);
    else localStorage.removeItem(STORAGE_KEYS.defaultGroup);
    renderTables();
});
elements.budget.addEventListener("change", event => loadBudget(event.target.value));

const initialise = async () => {
    renderGroups();
    try {
        const budgets = await ZSBudgets.list();
        for (const budget of budgets) {
            const option = document.createElement("option");
            option.value = budget.id;
            option.textContent = budget.name;
            elements.budget.append(option);
        }
        const saved = localStorage.getItem(STORAGE_KEYS.budget);
        const budgetId = budgets.some(budget => budget.id === saved) ? saved : budgets[0]?.id;
        if (budgetId) { elements.budget.value = budgetId; await loadBudget(budgetId); }
        else { message(elements.accounts, "No budgets found."); message(elements.categories, "No budgets found."); }
    } catch (error) {
        message(elements.accounts, `Unable to load budgets: ${error.message}`);
        message(elements.categories, `Unable to load budgets: ${error.message}`);
    }
};

initialise();
