const isOverviewPage = () => {
    // /budget/id, not /budget/id/
    const pathParts = window.location.pathname.split("/");
    if (pathParts[2])
        return false;
    return true;
}

const waitForElement = (selector, callback) => {
    // Check if it already exists first
    const element = document.querySelector(selector);
    if (element) {
        callback(element);
        return;
    }

    // If not, observe the DOM changes
    const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
            obs.disconnect(); // Stop watching once found
            callback(el);
        }
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
    });
}

const extensionApi = globalThis.browser ?? globalThis.chrome;

const formatCurrency = cents => `£${(Number(cents || 0) / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})}`;

const amountFor = item => Number(
    item.balance
    ?? item.available
    ?? ((item.clearedBalance ?? 0) + (item.unclearedBalance ?? 0))
    ?? item.amount
    ?? 0,
);

const effectiveGroupId = (item, kind, assignments, defaultGroupId) => {
    if (Object.prototype.hasOwnProperty.call(assignments[kind] ?? {}, item.id)) {
        return assignments[kind][item.id];
    }
    if (kind === "categories" && item.group?.id
        && Object.prototype.hasOwnProperty.call(assignments.categoryGroups ?? {}, item.group.id)) {
        return assignments.categoryGroups[item.group.id];
    }
    return defaultGroupId;
};

const createUuidV7 = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const timestamp = BigInt(Date.now());
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = Number(timestamp >> BigInt((5 - index) * 8)) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const findArray = (payload, names) => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    for (const name of names) if (Array.isArray(payload[name])) return payload[name];
    for (const value of Object.values(payload)) {
        const result = findArray(value, names);
        if (result.length) return result;
    }
    return [];
};

const findCompactBudget = payload => {
    if (!payload || typeof payload !== "object") return null;
    if (payload.budgetsByMonthCompact) return payload;
    for (const value of Object.values(payload)) {
        const result = findCompactBudget(value);
        if (result) return result;
    }
    return null;
};

const normaliseLiveData = (accountsPayload, metaPayload, budgetPayload) => {
    const accounts = [
        ...findArray(accountsPayload, ["bankAccounts"]),
        ...findArray(accountsPayload, ["loanAccounts"]),
    ].filter(account => (
        ["budget", "credit_card"].includes(String(account.type).toLowerCase())
        && account.closed === false
    ));
    const categoryGroups = findArray(metaPayload, ["categoryGroups"])
        .filter(group => group.isHidden === false && group.systemType !== "CREDIT_CARD_PAYMENTS");
    const groupsById = new Map(categoryGroups.map(group => [group.id, group]));
    const categories = findArray(metaPayload, ["categories"])
        .flatMap(item => Array.isArray(item.categories) ? item.categories : [item])
        .map(category => ({
            ...category,
            id: category.id ?? category.categoryId,
            name: category.name ?? category.categoryName,
            group: groupsById.get(category.categoryGroupId ?? category.groupId),
        }))
        .filter(category => category.id && category.isHidden === false && category.group);

    const budgetRoot = findCompactBudget(budgetPayload);
    const compact = budgetRoot?.budgetsByMonthCompact;
    const monthKeys = compact?.months ?? Object.keys(compact?.cells ?? {});
    const latestMonth = budgetRoot?.currentMonth ?? monthKeys[monthKeys.length - 1];
    const monthCells = compact?.cells?.[latestMonth] ?? {};
    const assignedById = new Map(Object.entries(monthCells).map(([categoryId, values]) => [
        categoryId,
        values?.available ?? ((values?.assigned ?? 0) + (values?.activity ?? 0)),
    ]));
    for (const category of categories) {
        if (assignedById.has(category.id)) category.balance = assignedById.get(category.id);
    }
    return { accounts, categories };
};

const createTransfer = async (transfer, sourceAccountId, destinationAccountId, button) => {
    if (!sourceAccountId || !destinationAccountId) {
        button.textContent = "Accounts required";
        return;
    }
    button.disabled = true;
    button.textContent = "Creating…";
    try {
        const response = await fetch("https://api.zerosumapp.com/trpc/budget.accounts.transactions.create?batch=1", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                "0": {
                    json: {
                        accountId: sourceAccountId,
                        amount: -Math.abs(Math.round(transfer.amount)),
                        cleared: false,
                        date: new Date().toISOString().slice(0, 10),
                        note: "#created-by-zcb",
                        id: createUuidV7(),
                        transferAccountId: destinationAccountId,
                    },
                },
            }),
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        button.textContent = "Created";
    } catch (error) {
        button.disabled = false;
        button.textContent = `Retry (${error.message})`;
    }
};

const showCategoryGroups = async ({ attach = true } = {}) => {
    const appMain = document.querySelector("#app-main");
    if (!appMain) return;

    const stored = await extensionApi.storage.local.get([
        "accountGroups", "accountGroupAssignments", "accounts", "categories", "defaultAccountGroup", "selectedBudget",
    ]);
    const accountGroups = stored.accountGroups ?? [];
    const budgetId = stored.selectedBudget || window.location.pathname.split("/")[2];
    const assignments = stored.accountGroupAssignments?.[budgetId] ?? {
        accounts: {}, categories: {}, categoryGroups: {},
    };
    const defaultGroupId = stored.defaultAccountGroup || null;
    let accounts = stored.accounts ?? [];
    let categories = stored.categories ?? [];
    try {
        const live = await extensionApi.runtime.sendMessage({ type: "zcb-load-budget-data", budgetId });
        if (!live?.ok) throw new Error(live?.error || "Could not load current budget data");
        ({ accounts, categories } = normaliseLiveData(live.accounts, live.meta, live.budget));
    } catch (error) {
        console.warn("ZCB: using cached budget data", error);
    }

    const totals = new Map(accountGroups.map(group => [group.id, {
        group,
        accounts: [],
        accountTotal: 0,
        creditCardTotal: 0,
        categoryTotal: 0,
    }]));
    for (const account of accounts) {
        const groupId = effectiveGroupId(account, "accounts", assignments, defaultGroupId);
        const total = totals.get(groupId);
        if (!total) continue;
        const amount = amountFor(account);
        total.accounts.push(account);
        if (account.type === "credit_card") total.creditCardTotal += amount;
        else total.accountTotal += amount;
    }
    for (const category of categories) {
        const groupId = effectiveGroupId(category, "categories", assignments, defaultGroupId);
        const total = totals.get(groupId);
        if (total) total.categoryTotal += amountFor(category);
    }

    const summaries = [...totals.values()].map(total => ({
        ...total,
        required: total.categoryTotal + Math.abs(total.creditCardTotal),
    }));

    appMain.querySelector(".category-balances-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "category-balances-overlay";
    overlay.addEventListener("click", event => {
        if (event.target === overlay) overlay.remove();
    });

    const popup = document.createElement("section");
    popup.className = "category-balances-popup";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "category-balances-close";
    close.setAttribute("aria-label", "Close category groups");
    close.textContent = "×";
    close.addEventListener("click", () => overlay.remove());

    const heading = document.createElement("h1");
    heading.textContent = "Category balances";
    popup.append(close, heading);

    if (!accountGroups.length) {
        const empty = document.createElement("p");
        empty.textContent = "No account groups configured yet.";
        popup.append(empty);
    } else {
        const summaryList = document.createElement("div");
        summaryList.className = "category-balances-summary";
        for (const summary of summaries) {
            const card = document.createElement("article");
            card.className = "category-balances-card";
            card.innerHTML = `<h2></h2><p>Accounts (Credit Cards): <strong></strong> (<strong></strong>)</p><p>Assigned: <strong></strong></p><p>Total needed: <strong></strong></p>`;
            const values = card.querySelectorAll("strong");
            card.querySelector("h2").textContent = summary.group.name || "Unnamed group";
            values[0].textContent = formatCurrency(summary.accountTotal);
            values[1].textContent = formatCurrency(summary.creditCardTotal);
            values[2].textContent = formatCurrency(summary.categoryTotal);
            values[3].textContent = formatCurrency(summary.required);
            summaryList.append(card);
        }
        popup.append(summaryList);

        const transfers = [];
        const surplus = summaries.filter(summary => summary.accountTotal - summary.required > 0)
            .map(summary => ({ ...summary, remaining: summary.accountTotal - summary.required }));
        const deficit = summaries.filter(summary => summary.accountTotal - summary.required < 0)
            .map(summary => ({ ...summary, remaining: summary.required - summary.accountTotal }));
        for (const destination of deficit) {
            for (const source of surplus) {
                if (destination.remaining <= 0) break;
                const amount = Math.min(source.remaining, destination.remaining);
                if (amount <= 0) continue;
                transfers.push({ source, destination, amount });
                source.remaining -= amount;
                destination.remaining -= amount;
            }
        }

        if (transfers.length) {
            const transferHeading = document.createElement("h2");
            transferHeading.textContent = "Transfers needed";
            popup.append(transferHeading);
            const table = document.createElement("table");
            table.className = "category-balances-transfers";
            table.innerHTML = "<thead><tr><th>Source Account</th><th>Value</th><th>Destination Account</th><th>From Account</th><th>To Account</th><th>Action</th></tr></thead>";
            const body = document.createElement("tbody");
            for (const transfer of transfers) {
                const row = document.createElement("tr");
                const sourceAccounts = transfer.source.accounts.filter(account => account.type !== "credit_card");
                const destinationAccounts = transfer.destination.accounts.filter(account => account.type !== "credit_card");
                const fromAccounts = sourceAccounts.length ? sourceAccounts : transfer.source.accounts;
                const toAccounts = destinationAccounts.length ? destinationAccounts : transfer.destination.accounts;
                row.innerHTML = `<td></td><td></td><td></td>`;
                row.children[0].textContent = transfer.source.group.name;
                row.children[1].textContent = formatCurrency(transfer.amount);
                row.children[2].textContent = transfer.destination.group.name;
                const from = document.createElement("select");
                const to = document.createElement("select");
                for (const account of fromAccounts) from.add(new Option(account.name, account.id));
                for (const account of toAccounts) to.add(new Option(account.name, account.id));
                const highestBalanceSource = [...fromAccounts]
                    .sort((left, right) => amountFor(right) - amountFor(left))[0];
                if (highestBalanceSource) from.value = highestBalanceSource.id;
                const highestBalanceDestination = [...toAccounts]
                    .sort((left, right) => amountFor(right) - amountFor(left))[0];
                if (highestBalanceDestination) to.value = highestBalanceDestination.id;
                const actionCell = document.createElement("td");
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = fromAccounts.length && toAccounts.length ? "Create" : "No account";
                button.disabled = !fromAccounts.length || !toAccounts.length;
                button.addEventListener("click", () => createTransfer(transfer, from.value, to.value, button));
                row.append(document.createElement("td"), document.createElement("td"), actionCell);
                row.children[3].append(from);
                row.children[4].append(to);
                actionCell.append(button);
                body.append(row);
            }
            table.append(body);
            popup.append(table);
        }
    }

    overlay.append(popup);
    if (attach) appMain.append(overlay);
    return overlay;
};

const addPopupStyles = () => {
    if (document.getElementById("category-balances-styles")) return;
    const style = document.createElement("style");
    style.id = "category-balances-styles";
    style.textContent = `
        .category-balances-overlay {
            align-items: center;
            background: color-mix(in oklch, var(--background) 70%, transparent);
            display: flex;
            inset: 0;
            justify-content: center;
            position: fixed;
            z-index: 9999;
        }
        .category-balances-popup {
            background: var(--popover);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 20px 60px color-mix(in oklch, var(--background) 75%, transparent);
            box-sizing: border-box;
            color: var(--popover-foreground);
            max-height: 90vh;
            max-width: 92vw;
            min-width: min(520px, 92vw);
            overflow: auto;
            padding: 32px;
            position: relative;
            width: 1100px;
        }
        .category-balances-close {
            background: var(--control);
            border: 0;
            border-radius: 6px;
            color: var(--popover-foreground);
            cursor: pointer;
            font-size: 28px;
            line-height: 1;
            padding: 2px 8px;
            position: absolute;
            right: 12px;
            top: 10px;
        }
        .category-balances-close:hover {
            background: var(--accent);
        }
        .category-balances-popup h1 {
            color: var(--popover-foreground);
        }
        .category-balances-popup li {
            border-bottom: 1px solid var(--border-subtle);
            padding: 8px 0;
        }
        .category-balances-summary {
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .category-balances-card {
            background: var(--card);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 14px;
        }
        .category-balances-card h2 {
            color: var(--card-foreground);
            font-size: 16px;
            margin: 0 0 10px;
        }
        .category-balances-card p { color: var(--muted-foreground); margin: 7px 0; }
        .category-balances-card strong { color: var(--card-foreground); }
        .category-balances-transfers {
            border-collapse: collapse;
            width: 100%;
        }
        .category-balances-transfers th,
        .category-balances-transfers td {
            border-bottom: 1px solid var(--border-subtle);
            padding: 8px;
            text-align: left;
        }
        .category-balances-transfers select,
        .category-balances-transfers button {
            background: var(--input);
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--foreground);
            padding: 5px 7px;
        }
        .category-balances-transfers select {
            background: color-mix(in oklab, var(--muted) 20%, transparent);
            border-color: color-mix(in oklab, var(--border) 60%, transparent);
            border-style: solid;
            border-width: 1px;
        }
        .category-balances-transfer-block button,
        .category-balances-transfers button {
            background: color-mix(in oklab, var(--muted) 40%, transparent);
            color: var(--foreground);
            font-weight: 600;
        }
        .category-balances-transfer-block select {
            background: color-mix(in oklab, var(--muted) 20%, transparent);
            border-color: color-mix(in oklab, var(--border) 60%, transparent);
            border-style: solid;
            border-width: 1px;
            color: var(--foreground);
        }
        .category-balances-transfer-blocks {
            display: grid;
            gap: var(--spacing);
        }
        .category-balances-transfer-block {
            background: var(--card);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            display: grid;
            font-size: var(--text-sm);
            gap: var(--spacing);
            padding: var(--spacing);
        }
        .category-balances-transfer-block label {
            align-items: center;
            display: flex;
            gap: var(--spacing);
        }
        .category-balances-transfer-block > strong {
            color: var(--muted-foreground);
            font-size: var(--text-s);
        }
        .category-balances-transfer-block select {
            background: color-mix(in oklab, var(--muted) 20%, transparent);
            border-color: color-mix(in oklab, var(--border) 60%, transparent);
            border-style: solid;
            border-width: 1px;
            border-radius: 8px;
            flex: 1;
            padding: var(--spacing);
        }
        .category-balances-actions {
            display: flex;
            gap: var(--spacing);
            margin-left: auto;
        }
        .category-balances-actions button {
            background: color-mix(in oklab, var(--muted) 40%, transparent);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--foreground);
            cursor: pointer;
            font-size: var(--text-sm);
            padding: var(--spacing);
        }
        .category-balances-actions button,
        .category-balances-transfer-block button {
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            font-size: var(--text-sm);
            padding: var(--spacing);
        }
    `;
    (document.head || document.documentElement)?.append(style);
};

addPopupStyles();

const isBudgetOverview = () => /^\/budget\/[^/]+\/?$/.test(window.location.pathname);

const renderOverview = async () => {
    if (!isBudgetOverview()) return;
    const side = document.querySelector("#budget-table-side");
    const source = side?.querySelector(":scope > section") || side?.querySelector("section");
    if (!side || side.dataset.zcbRendering || side.querySelector("[data-zcb-overview]") || !source) return;
    side.dataset.zcbRendering = "true";

    const overview = source.cloneNode(true);
    overview.setAttribute("data-zcb-overview", "true");
    overview.querySelectorAll("h4 svg").forEach(svg => svg.remove());
    const heading = overview.querySelector("h4 button span");
    if (heading) heading.textContent = "Account Balances";

    const overlay = await showCategoryGroups({ attach: false });
    if (!overlay) {
        delete side.dataset.zcbRendering;
        return;
    }
    const transfers = overlay.querySelector(".category-balances-transfers");
    overlay.remove();

    const nestedSections = overview.querySelectorAll("section");
    const content = nestedSections[nestedSections.length - 1] || overview;
    content.replaceChildren();
    if (transfers) {
        const blocks = document.createElement("div");
        blocks.className = "category-balances-transfer-blocks";
        for (const row of transfers.querySelectorAll("tbody tr")) {
            const block = document.createElement("article");
            block.className = "category-balances-transfer-block";
            const summary = document.createElement("strong");
            summary.textContent = `${row.cells[0].textContent} => ${row.cells[1].textContent} => ${row.cells[2].textContent}`;
            block.append(summary);
            const fromLabel = document.createElement("label");
            fromLabel.textContent = "From: ";
            fromLabel.append(row.cells[3].firstElementChild);
            const toLabel = document.createElement("label");
            toLabel.textContent = "To: ";
            toLabel.append(row.cells[4].firstElementChild);
            block.append(fromLabel, toLabel, row.cells[5].firstElementChild);
            blocks.append(block);
        }
        content.append(blocks);
    }
    const actions = document.createElement("div");
    actions.className = "category-balances-actions";
    const openPopup = document.createElement("button");
    openPopup.type = "button";
    openPopup.textContent = "Open";
    openPopup.addEventListener("click", () => showCategoryGroups());
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = "Settings";
    settings.addEventListener("click", () => extensionApi.runtime.sendMessage({ type: "zcb-open-options" }));
    actions.append(openPopup, settings);
    const overviewHeading = overview.querySelector("h4");
    if (overviewHeading) {
        overviewHeading.style.alignItems = "center";
        overviewHeading.style.display = "flex";
        const overviewHeadingButton = overviewHeading.querySelector("button");
        if (overviewHeadingButton) overviewHeadingButton.style.flex = "1";
        overviewHeading.append(actions);
    } else {
        content.append(actions);
    }

    source.parentElement.insertBefore(overview, source);
    delete side.dataset.zcbRendering;
};

const initialise = () => {
    if (isBudgetOverview()) waitForElement("#budget-table-side", renderOverview);
    else document.querySelector("[data-zcb-overview]")?.remove();
};

initialise();
window.addEventListener("popstate", initialise);
window.addEventListener("hashchange", initialise);
const overviewObserver = new MutationObserver(initialise);
overviewObserver.observe(document.documentElement, { childList: true, subtree: true });
