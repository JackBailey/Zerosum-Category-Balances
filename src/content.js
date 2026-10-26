function waitForElement(selector, callback) {
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

// inject sidebar button
waitForElement("[data-slot=sidebar-group] ul", (element) => {
    const accountsButton = element.querySelector("li:has(a[aria-label='Accounts'])");
    console.log(accountsButton);

    const categoryBalancesButton = accountsButton.cloneNode(true);
    const anchor = categoryBalancesButton.querySelector("a");
    anchor.setAttribute("aria-label", "Category Balances");
    anchor.setAttribute("href", "#");
    anchor.removeEventListener("click", () => {});
    const text = categoryBalancesButton.querySelector("span.mantine-NavLink-label > span");
    text.textContent = "Category Balances";

    element.appendChild(categoryBalancesButton);
});