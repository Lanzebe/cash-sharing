const $ = (sel) => document.querySelector(sel);

const CURRENCIES = ["ZAR", "EUR", "USD", "GBP", "AUD", "CAD", "JPY", "CHF", "NZD"];

function fmt(n) {
  const v = Number(n) || 0;
  const cur = window.CURRENCY || "ZAR";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function initThemeToggle() {
  const btn = $("#theme-toggle");
  if (!btn) return;
  const update = () => {
    const dark = document.documentElement.dataset.theme !== "light";
    btn.textContent = dark ? "☀️" : "🌙";
  };
  update();
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  });
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

async function api(path, options = {}) {
  const opts = { method: "GET", headers: {}, ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    throw new Error("Cannot reach the server");
  }
  if (res.status === 401 && path !== "/me") {
    window.location.href = "/";
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "index") initIndex();
  if (page === "group") initGroup();
});

async function initIndex() {
  window.CURRENCY = "ZAR";
  initThemeToggle();

  let me = null;
  try {
    me = await api("/me");
  } catch (err) {}

  if (me) {
    showApp(me);
  } else {
    $("#login-view").hidden = false;
    $("#login-form").hidden = false;
  }

  const showTab = (which) => {
    $("#login-form").hidden = which !== "login";
    $("#register-form").hidden = which !== "register";
    $("#show-login").classList.toggle("active", which === "login");
    $("#show-register").classList.toggle("active", which === "register");
  };
  $("#show-login").addEventListener("click", () => showTab("login"));
  $("#show-register").addEventListener("click", () => showTab("register"));

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = $("#login-error");
    errEl.textContent = "";
    try {
      await api("/login", {
        method: "POST",
        body: { username: f.username.value, password: f.password.value },
      });
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = $("#register-error");
    errEl.textContent = "";
    try {
      await api("/register", {
        method: "POST",
        body: { username: f.username.value, password: f.password.value },
      });
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (err) {}
    window.location.reload();
  });

  $("#new-group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const g = await api("/api/groups", {
        method: "POST",
        body: { name: f.name.value, currency: f.currency.value },
      });
      window.location.href = `/group.html?id=${encodeURIComponent(g.id)}`;
    } catch (err) {
      alert(err.message);
    }
  });
}

function showApp(me) {
  $("#login-view").hidden = true;
  const appView = $("#app-view");
  appView.hidden = false;
  const list = $("#group-list");
  list.innerHTML = "";
  if (!me.groups.length) {
    list.innerHTML = '<li class="muted">No groups yet — create one above.</li>';
    return;
  }
  for (const g of me.groups) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/group.html?id=${encodeURIComponent(g.id)}`;
    a.textContent = g.name;
    li.appendChild(a);
    list.appendChild(li);
  }
}

async function initGroup() {
  const gid = new URLSearchParams(location.search).get("id");
  if (!gid) {
    location.href = "/";
    return;
  }
  window.GID = gid;

  let me;
  try {
    me = await api("/me");
  } catch (err) {
    location.href = "/";
    return;
  }

  $("#back-link").addEventListener("click", () => { location.href = "/"; });
  initThemeToggle();
  $("#logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
  });

  $("#new-txn-form").addEventListener("submit", onAddTransaction);
  $("#new-txn-form").addEventListener("input", recomputeSplit);
  $("#add-member-form").addEventListener("submit", onAddMember);
  $("#new-tag-form").addEventListener("submit", onAddTag);
  $("#currency-form").addEventListener("submit", onChangeCurrency);

  window.SPLIT_MODE = "percent";
  $("#mode-percent").addEventListener("click", () => setSplitMode("percent"));
  $("#mode-amount").addEventListener("click", () => setSplitMode("amount"));

  window.MEMBERS = [];
  window.IS_OWNER = false;
  window.CURRENCY = "ZAR";
  window.REGISTERED = new Set();

  await loadGroup();
}

function memberLabel(m) {
  return window.REGISTERED.has(m) ? m : `${m} (guest)`;
}

async function onChangeCurrency(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/currency`, {
      method: "PUT",
      body: { currency: f.currency.value },
    });
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function loadGroup() {
  const group = await api(`/api/groups/${encodeURIComponent(window.GID)}`);
  window.MEMBERS = group.members;
  window.CURRENCY = group.currency;
  window.REGISTERED = new Set(group.registered_members || []);
  const me = (await api("/me")).username;
  window.IS_OWNER = group.owner === me;

  document.title = `${group.name} — CashSharing`;
  $("#group-name").textContent = group.name;

  fillPaidBy(group.members);
  renderTags(group.tags);
  renderMembers(group.members);
  buildSplitInputs(group.members);
  populateCurrencySelect();
  $("#currency-section").hidden = !window.IS_OWNER;
  await loadSummary();
}

function populateCurrencySelect() {
  const sel = $("#group-currency-select");
  sel.innerHTML = "";
  for (const c of CURRENCIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    opt.selected = c === window.CURRENCY;
    sel.appendChild(opt);
  }
}

function fillPaidBy(members) {
  const sel = $("#paid-by-select");
  sel.innerHTML = "";
  for (const m of members) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = `Paid by ${memberLabel(m)}`;
    sel.appendChild(opt);
  }
}

function buildSplitInputs(members) {
  const row = $("#split-row");
  row.innerHTML = "";
  const share = Math.round((100 / members.length) * 100) / 100;
  for (const m of members) {
    const label = document.createElement("label");
    label.className = "split-item";
    const span = document.createElement("span");
    span.textContent = memberLabel(m);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = window.SPLIT_MODE === "percent" ? "0.01" : "0.01";
    input.value = window.SPLIT_MODE === "amount" ? "0" : share;
    input.dataset.pct = m;
    const amount = document.createElement("input");
    amount.type = "text";
    amount.readOnly = true;
    amount.className = "split-amount";
    amount.dataset.amount = m;
    label.appendChild(span);
    label.appendChild(input);
    label.appendChild(amount);
    row.appendChild(label);
  }
  recomputeSplit();
}

function setSplitMode(mode) {
  window.SPLIT_MODE = mode;
  $("#mode-percent").classList.toggle("active", mode === "percent");
  $("#mode-amount").classList.toggle("active", mode === "amount");
  $("#new-txn-form").elements.total_amount.readOnly = mode === "amount";
  if (mode === "amount") {
    $("#new-txn-form").elements.total_amount.value = "";
  }
  buildSplitInputs(window.MEMBERS);
}

function recomputeSplit() {
  const f = $("#new-txn-form");
  if (window.SPLIT_MODE === "amount") {
    let total = 0;
    for (const m of window.MEMBERS) {
      const amt = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
      total += amt;
      const pctEl = document.querySelector(`[data-amount="${m}"]`);
      pctEl.value = total > 0 ? `${((amt / total) * 100).toFixed(2)}%` : "";
    }
    f.elements.total_amount.value = total > 0 ? total.toFixed(2) : "";
    return;
  }
  const total = parseFloat(f.elements.total_amount.value) || 0;
  for (const m of window.MEMBERS) {
    const pct = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
    const amt = document.querySelector(`[data-amount="${m}"]`);
    amt.value = fmt((total * pct) / 100);
  }
}

async function onAddTransaction(e) {
  e.preventDefault();
  const f = e.target;
  const split = {};
  for (const m of window.MEMBERS) {
    split[m] = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
  }
  const body = {
    description: f.description.value,
    total_amount: parseFloat(f.total_amount.value) || 0,
    paid_by: f.paid_by.value,
    split,
    split_mode: window.SPLIT_MODE,
    tag: f.tag.value,
  };
  try {
    const res = await api(`/api/groups/${encodeURIComponent(window.GID)}/transactions`, {
      method: "POST",
      body,
    });
    const fileInput = $("#receipt-input");
    if (fileInput && fileInput.files.length) {
      await uploadReceipt(window.GID, res.id, fileInput.files[0]);
    }
    f.reset();
    setSplitMode("percent");
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function uploadReceipt(gid, tid, file) {
  const fd = new FormData();
  fd.append("file", file);
  try {
    await api(`/api/groups/${encodeURIComponent(gid)}/transactions/${encodeURIComponent(tid)}/receipt`, {
      method: "POST",
      body: fd,
    });
  } catch (err) {
    alert(`Transaction added, but receipt upload failed: ${err.message}`);
  }
}

async function onAddMember(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/members`, {
      method: "POST",
      body: { username: f.username.value },
    });
    f.reset();
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function onAddTag(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/tags`, {
      method: "POST",
      body: { tag: f.tag.value },
    });
    f.reset();
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function onDeleteTransaction(tid) {
  if (!confirm("Delete this transaction?")) return;
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/transactions/${tid}`, {
      method: "DELETE",
    });
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function loadSummary() {
  const s = await api(`/api/groups/${encodeURIComponent(window.GID)}/summary`);

  $("#total-spend").textContent = fmt(s.total_spend);

  const balances = $("#balances");
  balances.innerHTML = "";
  const bEntries = Object.entries(s.balances);
  if (!bEntries.length) {
    balances.innerHTML = '<li class="muted">No transactions yet</li>';
  } else {
for (const [person, amount] of bEntries) {
      const li = document.createElement("li");
      li.textContent = `${esc(person)} ${amount < 0 ? "owes" : "is owed"} ${fmt(Math.abs(amount))}`;
      balances.appendChild(li);
    }
  }

  const settlements = $("#settlements");
  settlements.innerHTML = "";
  if (!s.settlements.length) {
    settlements.innerHTML = '<li class="muted">All settled up</li>';
  } else {
    for (const st of s.settlements) {
      const li = document.createElement("li");
      li.textContent = `${esc(st.debtor)} → ${esc(st.creditor)}: ${fmt(st.amount)}`;
      settlements.appendChild(li);
    }
  }

  const tagTotals = $("#tag-totals");
  tagTotals.innerHTML = "";
  const tEntries = Object.entries(s.tags);
  if (!tEntries.length) {
    tagTotals.innerHTML = '<li class="muted">No spending yet</li>';
  } else {
    for (const [tag, total] of tEntries) {
      const li = document.createElement("li");
      li.textContent = `${esc(tag)}: ${fmt(total)}`;
      tagTotals.appendChild(li);
    }
  }

  renderTransactions(s.transactions);
}

function splitLabel(t) {
  if (t.split_mode === "amount") {
    return Object.entries(t.split_amounts)
      .map(([p, a]) => `${esc(p)} ${fmt(a)}`)
      .join(", ");
  }
  return Object.entries(t.split_percent)
    .map(([p, pct]) => `${esc(p)} ${pct}%`)
    .join(", ");
}

function renderTransactions(transactions) {
  const tbody = $("#txn-body");
  tbody.innerHTML = "";
  $("#txn-empty").hidden = transactions.length > 0;
  for (const t of transactions) {
    const tr = document.createElement("tr");
    const split = splitLabel(t);
    const paidBy = Object.entries(t.paid_by)
      .map(([p, a]) => `${esc(p)} ${fmt(a)}`)
      .join(", ");
    const receipt = t.receipt
      ? `<a class="link" target="_blank" rel="noopener" href="/api/groups/${encodeURIComponent(window.GID)}/transactions/${encodeURIComponent(t.id)}/receipt">View</a>`
      : "<span class='muted'>—</span>";
    tr.innerHTML =
      `<td>${esc(t.description)}</td>` +
      `<td><span class="pill">${esc(t.tag)}</span></td>` +
      `<td>${fmt(t.total_amount)}</td>` +
      `<td>${paidBy}</td>` +
      `<td>${split}</td>` +
      `<td>${receipt}</td>` +
      `<td><button class="danger" data-del="${esc(t.id)}">Delete</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-del]").addEventListener("click", () => onDeleteTransaction(t.id));
  }
}

function renderMembers(members) {
  const list = $("#member-list");
  list.innerHTML = "";
  for (const m of members) {
    const li = document.createElement("li");
    li.textContent = memberLabel(m);
    if (!window.REGISTERED.has(m)) {
      li.dataset.guest = "true";
    }
    list.appendChild(li);
  }
}

function renderTags(tags) {
  const tagSelect = $("#tag-select");
  tagSelect.innerHTML = "";
  const tagList = $("#tag-list");
  tagList.innerHTML = "";
  for (const tag of tags) {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = tag;
    tagSelect.appendChild(opt);

    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = tag;
    const rm = document.createElement("button");
    rm.className = "chip-x";
    rm.textContent = "×";
    rm.addEventListener("click", () => onRemoveTag(tag));
    span.appendChild(rm);
    tagList.appendChild(span);
  }
}

async function onRemoveTag(tag) {
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    });
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}