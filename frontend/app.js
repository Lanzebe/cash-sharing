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
    const meLabel = $("#me-label");
    if (meLabel) meLabel.hidden = true;
    const prompt = $("#name-prompt");
    if (prompt) prompt.hidden = true;
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
        body: { email: f.email.value, password: f.password.value },
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
        body: { email: f.email.value, password: f.password.value },
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

  const addGroupBtn = $("#add-group-btn");
  addGroupBtn.addEventListener("click", () => {
    const form = $("#new-group-form");
    form.hidden = !form.hidden;
    if (!form.hidden) {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.name.focus();
    }
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

  const nameForm = $("#name-form");
  if (nameForm) {
    nameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#name-error");
      errEl.textContent = "";
      try {
        const res = await api("/me", {
          method: "PUT",
          body: { display_name: nameForm.elements.name.value },
        });
        const meLabel = $("#me-label");
        if (meLabel) meLabel.textContent = res.display_name;
        $("#name-prompt").hidden = true;
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }
}

function renderTotals(groups) {
  const bar = $("#totals-bar");
  bar.innerHTML = "";
  const totals = {};
  for (const g of groups) {
    totals[g.currency] = (totals[g.currency] || 0) + g.balance;
  }
  const keys = Object.keys(totals);
  bar.hidden = keys.length === 0;
  if (!keys.length) return;
  const label = document.createElement("span");
  label.className = "totals-label";
  label.textContent = "Net";
  bar.appendChild(label);
  for (const cur of keys.sort()) {
    const v = totals[cur];
    const cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    const span = document.createElement("span");
    span.className = `tot ${cls}`;
    span.textContent = `${cur} ${v > 0 ? "+" : ""}${v.toFixed(2)}`;
    span.title = v > 0 ? "You are owed" : v < 0 ? "You owe" : "Settled up";
    bar.appendChild(span);
  }
}

function showApp(me) {
  window.ME = me;
  $("#login-view").hidden = true;
  $("#logout-btn").hidden = false;
  const meLabel = $("#me-label");
  if (meLabel) {
    meLabel.textContent = me.display_name || me.email;
    meLabel.hidden = false;
  }
  const needsName = !me.display_name || me.display_name === me.email;
  const prompt = $("#name-prompt");
  if (prompt) prompt.hidden = !needsName;
  const appView = $("#app-view");
  appView.hidden = false;
  const list = $("#group-list");
  list.innerHTML = "";
  if (!me.groups.length) {
    list.innerHTML = '<li class="muted empty-note">No groups yet — add one below.</li>';
  }
  renderTotals(me.groups);
  me.groups.forEach((g) => {
    const li = document.createElement("li");
    li.className = "group-card";
    const body = document.createElement("div");
    body.className = "group-body";

    const link = document.createElement("a");
    link.className = "group-main";
    link.href = `/group.html?id=${encodeURIComponent(g.id)}`;
    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = g.name;
    const meta = document.createElement("span");
    meta.className = "group-meta";
    meta.textContent = `${g.currency} · ${g.members.length} member${g.members.length === 1 ? "" : "s"}`;
    link.appendChild(name);
    link.appendChild(meta);
    body.appendChild(link);

    const bal = document.createElement("span");
    bal.className = "group-balance";
    const cls = g.balance > 0 ? "pos" : g.balance < 0 ? "neg" : "zero";
    bal.classList.add(cls);
    const sign = g.balance > 0 ? "+" : g.balance < 0 ? "−" : "";
    bal.textContent = `${sign}${g.currency} ${Math.abs(g.balance).toFixed(2)}`;
    bal.title = g.balance > 0 ? "You are owed" : g.balance < 0 ? "You owe" : "Settled up";
    body.appendChild(bal);

    li.appendChild(body);

    list.appendChild(li);
  });
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
  $("#remove-member-form").addEventListener("submit", onRemoveMember);
  $("#new-tag-form").addEventListener("submit", onAddTag);
  $("#currency-form").addEventListener("submit", onChangeCurrency);

  $("#delete-group-btn").addEventListener("click", async () => {
    if (!confirm("Delete this group and all its transactions? This cannot be undone.")) return;
    try {
      await api(`/api/groups/${encodeURIComponent(window.GID)}`, { method: "DELETE" });
      location.href = "/";
    } catch (err) {
      alert(err.message);
    }
  });

  window.SPLIT_MODE = "percent";
  window.EDITING_TID = null;
  $("#mode-percent").addEventListener("click", () => setSplitMode("percent"));
  $("#mode-amount").addEventListener("click", () => setSplitMode("amount"));
  $("#edit-cancel").addEventListener("click", cancelEdit);

  window.MEMBERS = [];
  window.IS_OWNER = false;
  window.CURRENCY = "ZAR";
  window.REGISTERED = new Set();

  await loadGroup();
}

function memberLabel(m) {
  if (!window.REGISTERED.has(m)) return `${m} (guest)`;
  return (window.DISPLAY_NAMES && window.DISPLAY_NAMES[m]) || m;
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
  window.DISPLAY_NAMES = group.display_names || {};
  window.GROUP_OWNER = group.owner;
  const meData = await api("/me");
  const meEmail = meData.email;
  window.IS_OWNER = group.owner === meEmail;

  const meLabel = $("#me-label");
  if (meLabel) meLabel.textContent = meData.display_name || meEmail;
  const danger = $("#danger-section");
  if (danger) danger.hidden = !window.IS_OWNER;

  document.title = `${group.name} — CashSharing`;
  $("#group-name").textContent = group.name;

  fillPaidBy(group.members);
  renderTags(group.tags);
  renderMembers(group.members);
  renderRemoveMemberSelect(group.members);
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

function defaultSplitValues(members) {
  const values = {};
  const n = members.length || 1;
  if (window.SPLIT_MODE === "percent") {
    const base = Math.floor((100 / n) * 100) / 100;
    members.forEach((m, i) => {
      values[m] = i === members.length - 1
        ? Math.round((100 - base * (n - 1)) * 100) / 100
        : base;
    });
  } else {
    members.forEach((m) => { values[m] = 0; });
  }
  return values;
}

function buildSplitInputs(members, prefill) {
  const row = $("#split-row");
  row.innerHTML = "";
  const values = prefill || defaultSplitValues(members);
  const unitText = window.SPLIT_MODE === "amount" ? window.CURRENCY : "%";
  for (const m of members) {
    const item = document.createElement("div");
    item.className = "split-item";
    const name = document.createElement("span");
    name.className = "split-name";
    name.textContent = memberLabel(m);
    const unit = document.createElement("span");
    unit.className = "split-unit";
    unit.textContent = unitText;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.className = "split-input";
    input.value = values[m];
    input.dataset.pct = m;
    const out = document.createElement("span");
    out.className = "split-out";
    out.dataset.amount = m;
    item.appendChild(name);
    item.appendChild(unit);
    item.appendChild(input);
    item.appendChild(out);
    row.appendChild(item);
  }
  recomputeSplit();
}

function setSplitMode(mode) {
  window.SPLIT_MODE = mode;
  $("#mode-percent").classList.toggle("active", mode === "percent");
  $("#mode-amount").classList.toggle("active", mode === "amount");
  const totalEl = $("#new-txn-form").elements.total_amount;
  if (mode === "amount") {
    totalEl.readOnly = true;
    totalEl.value = "";
  } else {
    totalEl.readOnly = false;
  }
  $("#total-unit").textContent = window.CURRENCY;
  buildSplitInputs(window.MEMBERS);
}

function recomputeSplit() {
  const f = $("#new-txn-form");
  const totalEl = f.elements.total_amount;
  if (window.SPLIT_MODE === "amount") {
    let total = 0;
    const vals = {};
    for (const m of window.MEMBERS) {
      const amt = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
      vals[m] = amt;
      total += amt;
    }
    totalEl.value = total > 0 ? total.toFixed(2) : "";
    for (const m of window.MEMBERS) {
      document.querySelector(`[data-amount="${m}"]`).textContent =
        total > 0 ? `${((vals[m] / total) * 100).toFixed(2)}%` : "";
    }
    $("#split-total").textContent = total > 0 ? `Total ${fmt(total)}` : "";
    return;
  }
  const total = parseFloat(totalEl.value) || 0;
  let sum = 0;
  for (const m of window.MEMBERS) {
    const pct = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
    sum += pct;
    document.querySelector(`[data-amount="${m}"]`).textContent = fmt((total * pct) / 100);
  }
  const totalEl2 = $("#split-total");
  totalEl2.textContent = `Split total: ${sum.toFixed(2)}%`;
  totalEl2.classList.toggle("bad", Math.round(sum * 100) !== 10000);
}

async function onAddTransaction(e) {
  e.preventDefault();
  const f = e.target;
  const split = {};
  for (const m of window.MEMBERS) {
    split[m] = parseFloat(document.querySelector(`[data-pct="${m}"]`).value) || 0;
  }
  if (window.SPLIT_MODE === "percent") {
    const sum = window.MEMBERS.reduce((acc, m) => acc + (split[m] || 0), 0);
    if (Math.round(sum * 100) !== 10000) {
      const last = window.MEMBERS[window.MEMBERS.length - 1];
      const adjusted = 100 - (sum - (split[last] || 0));
      if (adjusted < 0) {
        alert("Split percentages exceed 100%");
        return;
      }
      split[last] = Math.round(adjusted * 100) / 100;
    }
  }
  const body = {
    description: f.description.value,
    total_amount: parseFloat(f.total_amount.value) || 0,
    paid_by: f.paid_by.value,
    split,
    split_mode: window.SPLIT_MODE,
    tag: f.tag.value,
  };
  const isEdit = !!window.EDITING_TID;
  const base = `/api/groups/${encodeURIComponent(window.GID)}/transactions`;
  const url = isEdit ? `${base}/${encodeURIComponent(window.EDITING_TID)}` : base;
  try {
    const res = await api(url, { method: isEdit ? "PUT" : "POST", body });
    const fileInput = $("#receipt-input");
    if (fileInput && fileInput.files.length) {
      await uploadReceipt(window.GID, isEdit ? window.EDITING_TID : res.id, fileInput.files[0]);
    }
    cancelEdit();
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

function loadTransactionIntoForm(t) {
  window.EDITING_TID = t.id;
  const f = $("#new-txn-form");
  setSplitMode(t.split_mode === "amount" ? "amount" : "percent");
  f.description.value = t.description || "";
  f.total_amount.value = t.total_amount || "";
  if (!f.tag.querySelector(`option[value="${CSS.escape(t.tag)}"]`)) {
    const opt = document.createElement("option");
    opt.value = t.tag;
    opt.textContent = t.tag;
    f.tag.appendChild(opt);
  }
  f.tag.value = t.tag;
  const payer = Object.keys(t.paid_by || {})[0];
  if (payer && f.paid_by.querySelector(`option[value="${CSS.escape(payer)}"]`)) {
    f.paid_by.value = payer;
  }
  $("#receipt-input").value = "";
  const values = {};
  for (const m of window.MEMBERS) {
    values[m] = ((t.split_mode === "amount" ? t.split_amounts : t.split_percent) || {})[m] ?? 0;
  }
  buildSplitInputs(window.MEMBERS, values);
  $("#txn-section-title").textContent = "Edit transaction";
  $("#txn-submit").textContent = "Save changes";
  $("#edit-cancel").hidden = false;
  document.querySelector("#new-txn-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEdit() {
  window.EDITING_TID = null;
  const f = $("#new-txn-form");
  f.reset();
  $("#txn-section-title").textContent = "Add transaction";
  $("#txn-submit").textContent = "Add transaction";
  $("#edit-cancel").hidden = true;
  setSplitMode("percent");
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
      body: { member: f.member.value },
    });
    f.reset();
    await loadGroup();
  } catch (err) {
    alert(err.message);
  }
}

async function onRemoveMember(e) {
  e.preventDefault();
  const f = e.target;
  const member = f.member.value;
  if (!member) return;
  if (!confirm(`Remove ${memberLabel(member)} from this group?`)) return;
  try {
    await api(`/api/groups/${encodeURIComponent(window.GID)}/members/${encodeURIComponent(member)}`, {
      method: "DELETE",
    });
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
      li.textContent = `${esc(memberLabel(person))} ${amount < 0 ? "owes" : "is owed"} ${fmt(Math.abs(amount))}`;
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
      li.textContent = `${esc(memberLabel(st.debtor))} → ${esc(memberLabel(st.creditor))}: ${fmt(st.amount)}`;
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
      .map(([p, a]) => `${esc(memberLabel(p))} ${fmt(a)}`)
      .join(", ");
  }
  return Object.entries(t.split_percent)
    .map(([p, pct]) => `${esc(memberLabel(p))} ${pct}%`)
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
      .map(([p, a]) => `${esc(memberLabel(p))} ${fmt(a)}`)
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
      `<td><button class="edit-btn" data-edit="${esc(t.id)}">Edit</button> <button class="danger" data-del="${esc(t.id)}">Delete</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-edit]").addEventListener("click", () => loadTransactionIntoForm(t));
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

function renderRemoveMemberSelect(members) {
  const sel = $("#remove-member-select");
  if (!sel) return;
  sel.innerHTML = "";
  const owner = window.GROUP_OWNER;
  for (const m of members) {
    if (m === owner) continue;
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = memberLabel(m);
    sel.appendChild(opt);
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