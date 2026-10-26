// account group management

class ZCBAccountGroups {
    static list() {
        const groups = localStorage.getItem("accountGroups");
        return groups ? JSON.parse(groups) : [];
    }
    static create(name) {
        const groups = this.list();
        const groupId = Math.random().toString(36).slice(2, 8);
        groups.push({ name, id: groupId });
        localStorage.setItem("accountGroups", JSON.stringify(groups));
    }
    static remove(id) {
        const groups = this.list();
        localStorage.setItem("accountGroups", JSON.stringify(groups.filter(g => g.id !== id)));
    }
    static set(groups) {
        localStorage.setItem("accountGroups", JSON.stringify(groups));
    }
    static update(group) {
        const groups = this.list();
        this.set(groups.map(g => g.id === group.id ? group : g));
    }
    static createAccountGroupEl(name) {
        const el = document.createElement("div");
        el.id = group.id;

        el.className = "account-group";

        const groupNameLabel = document.createElement("label");
        groupNameLabel.textContent = "Group Name: ";

        const groupName = document.createElement("input");
        groupName.setAttribute("type", "text");
        groupName.value = group.name;
        groupName.addEventListener("input", e => {
            group.name = e.target.value;
            this.update(group);
        });

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => this.remove(group.id));

        el.append(groupNameLabel, groupName, removeBtn);
        return el;
    }
}

class ZSBudgets {
    static async list() {
        const url = "https://api.zerosumapp.com/api/v1/budgets";
        const response = await fetch(url, { credentials: "include" });
        const data = await response.json();
        console.log(data);
        return data;
    }
}

class ZSAccounts {
    static async list() {
        try {
            const url = "https://api.zerosumapp.com/api/v1/budgets/01a17963-085d-737e-bce5-d02a5efe55b5/accounts";
            const response = await fetch(url, {
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error(`Fetching accounts failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log(data);
            return data;
        } catch (e) {
            return { error: e.message };
        }
    }
}

const accountGroupsEl = document.getElementById("account-groups");
const createGroupBtn = document.getElementById("create-group");


const budgetEl = document.getElementById("budget-id");

const initBudgets = async () => {
    const budgets = await ZSBudgets.list();
    let selectedBudget = localStorage.getItem("selectedBudget");
    budgets.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        budgetEl.append(opt);
    });

    if (selectedBudget) {
        budgetEl.value = selectedBudget;
    } else {
        localStorage.setItem("selectedBudget", budgetEl.value);
        selectedBudget = budgetEl.value;
    }

    loadSelectedBudget(selectedBudget);
};

const loadSelectedBudget = (budgetId) => {
    const accountsEl = document.getElementById("accounts");

    const listAccounts = async () => {
        const accounts = await ZSAccounts.list();
        accounts.forEach(acc => {
            const el = document.createElement("div");
            el.textContent = acc.name;
            accountsEl.append(el);
        });
    };




};


createGroupBtn.addEventListener("click", () => {
    createAccountGroup("");
});

const init = async () => {
    // localStorage.removeItem("accountGroups");

    // const accountGroups = getAccountGroups();
    // listAccounts();
    // accountGroups.forEach(group => accountGroupsEl.append(createAccountGroupElement(group)));
    initBudgets();
};

init();
