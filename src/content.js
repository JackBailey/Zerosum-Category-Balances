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

const getAccounts =  async () => {
    const url = "https://api.zerosumapp.com/api/v1/budgets/01a17963-085d-737e-bce5-d02a5efe55b5/accounts";
    const response = await fetch(url, {
        credentials: "include"
    });
    const data = await response.json();
    console.log(data)
    return data;
}

// inject sidebar button
waitForElement("[data-slot=sidebar-group] ul", (element) => {
    const accountsButton = element.querySelector("li:has(a[aria-label='Accounts'])");
    
    const existingButton = document.getElementById("category-balances-button");
    if (existingButton) return;

    const categoryBalancesButton = accountsButton.cloneNode(true);
    const anchor = categoryBalancesButton.querySelector("a");
    anchor.setAttribute("aria-label", "Category Balances");
    anchor.setAttribute("href", "#");
    anchor.removeEventListener("click", () => {});
    anchor.setAttribute("id", "category-balances-button");
    
    const text = categoryBalancesButton.querySelector("span.mantine-NavLink-label > span");
    text.textContent = "Category Balances";

    categoryBalancesButton.addEventListener("click", () => {
        getAccounts();
    });

    element.appendChild(categoryBalancesButton);
});