// FIELD_LABELS, EXTRACTORS, mergeExtractions come from groq_extraction.js
// login/logout/authFetch/isLoggedIn/AuthRequiredError come from auth.js

const files = {
  commercialInvoice: null,
  undertaking:       null,
  exp:               null,
  salesContract:     null,
  packingList:       null,   // ← new
};
let extractedData = {};

/* ── File upload listeners ───────────────────── */
document.querySelectorAll('input[type="file"]').forEach(input => {
  input.addEventListener("change", e => {
    const docType = e.target.dataset.doc;
    const file    = e.target.files[0];
    files[docType] = file || null;
    const slot   = e.target.closest(".upload-slot");
    const status = slot.querySelector(".status");
    status.textContent = file ? "✓ " + file.name : "No file";
    slot.classList.toggle("filled", !!file);
    updateExtractButton();
  });
});

function updateExtractButton() {
  document.getElementById("extractBtn").disabled =
    !Object.values(files).some(f => f !== null);
}

/* ── Auth gate ──────────────────────────────────
 * Shows the login screen until a valid session exists. Everything else
 * in this file (file upload, extract, autofill) only runs once logged in.
 */
async function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  const { userEmail } = await chrome.storage.local.get("userEmail");
  document.getElementById("accountEmail").textContent = userEmail || "";
}

function showLogin(message = "") {
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("loginError").textContent = message;
}

async function initAuthGate() {
  if (await isLoggedIn()) {
    showApp();
  } else {
    showLogin();
  }
}
initAuthGate();

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn      = document.getElementById("loginBtn");
  const errorEl  = document.getElementById("loginError");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Logging in…";
  try {
    await login(email, password);
    document.getElementById("loginPassword").value = "";
    await showApp();
  } catch (err) {
    errorEl.textContent = err.message || "Login failed.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Log in";
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await logout();
  showLogin();
});

/* ── Extract button ──────────────────────────── */
document.getElementById("extractBtn").addEventListener("click", async () => {
  const btn = document.getElementById("extractBtn");
  btn.disabled = true;

  const perDoc = {};
  for (const [docType, file] of Object.entries(files)) {
    if (!file) continue;
    if (!EXTRACTORS[docType]) continue; // e.g. packingList — uploaded as a doc, not AI-extracted
    try {
      btn.textContent = `Reading ${docType}…`;
      const text = await extractTextFromPdf(file);
      btn.textContent = `AI reading ${docType}…`;
      perDoc[docType] = await EXTRACTORS[docType](text);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        showLogin(err.message);
        btn.disabled = false;
        btn.textContent = "Extract Data";
        return;
      }
      console.error(`Failed on ${docType}:`, err);
      document.getElementById("autofillStatus").textContent = `Error on ${docType}: ${err.message}`;
      perDoc[docType] = {};
    }
  }

  extractedData = mergeExtractions(perDoc);
  renderReviewTable(extractedData);
  document.getElementById("review-section").classList.remove("hidden");
  btn.textContent = "Re-extract";
  btn.disabled = false;
});

/* ── Review table ────────────────────────────── */
function formatArrayForDisplay(arr) {
  if (!arr.length) return "";
  // Products array: [{product, code, ...}]
  if (typeof arr[0] === "object" && arr[0] !== null && "product" in arr[0] && "code" in arr[0]) {
    return arr.map(p => `${p.product ?? ""}:${p.code ?? ""}`).join(", ");
  }
  // Any other array (e.g. address lines): join as plain text, one item per line.
  return arr.map(item => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
}

function renderReviewTable(data) {
  const container = document.getElementById("fieldsTable");
  container.innerHTML = "";
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const val = Array.isArray(data[key])
      ? formatArrayForDisplay(data[key])
      : (data[key] || "");
    const row   = document.createElement("div");
    row.className = "field-row";
    const lbl   = document.createElement("label");
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type  = "text";
    input.dataset.field = key;
    input.value = val;
    if (!val) input.placeholder = "Not found";
    row.appendChild(lbl);
    row.appendChild(input);
    container.appendChild(row);
  }
}

function collectEditedData() {
  const data = { ...extractedData }; // keep products array
  document.querySelectorAll("#fieldsTable input").forEach(input => {
    data[input.dataset.field] = input.value;
  });
  return data;
}

/* ── Save button ─────────────────────────────── */
document.getElementById("saveDataBtn").addEventListener("click", async () => {
  const data = collectEditedData();
  await chrome.storage.local.set({ bepzaExtractedData: data });
  const s = document.getElementById("autofillStatus");
  s.textContent = "Saved.";
  setTimeout(() => s.textContent = "", 1500);
});

/* ── File → base64 for BEPZA document upload ─── */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve({
      name: file.name,
      type: file.type || "application/pdf",
      data: reader.result.split(",")[1], // base64 only
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function collectFilesForUpload() {
  // Map extension docType → BEPZA page label pattern
  const docMap = [
    { docType: "commercialInvoice", label: "Commercial Invoice" },
    { docType: "packingList",       label: "Packing list"       },
    { docType: "exp",               label: "EXP form"           },
    { docType: "salesContract",     label: "T.T"                },
    { docType: "undertaking",       label: "Undertaking"        },
  ];
  const uploads = [];
  for (const { docType, label } of docMap) {
    if (files[docType]) {
      const b64 = await fileToBase64(files[docType]);
      uploads.push({ label, ...b64 });
    }
  }
  return uploads;
}

/* ── Content script injection ────────────────── */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "BEPZA_PING" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content_script.js"] });
    await new Promise(r => setTimeout(r, 300));
  }
}

/* ── Autofill button ─────────────────────────── */
document.getElementById("autofillBtn").addEventListener("click", async () => {
  const data = collectEditedData();
  await chrome.storage.local.set({ bepzaExtractedData: data });

  const statusEl = document.getElementById("autofillStatus");
  const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes("web.bepza.gov.bd")) {
    statusEl.textContent = "Open the BEPZA form page first, then click Autofill.";
    return;
  }

  const btn = document.getElementById("autofillBtn");
  btn.disabled = true;

  try {
    btn.textContent = "Connecting…";
    await ensureContentScriptInjected(tab.id);

    btn.textContent = "Filling form…";
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type:     "BEPZA_AUTOFILL",
      data,                              // all flat fields
      products: data.products || [],     // [{code, product}] for multi-row
    });

    statusEl.textContent = `✓ Filled ${resp.filledCount} field(s). Uploading documents…`;

    // Upload PDFs to BEPZA supporting documents section
    const uploads = await collectFilesForUpload();
    if (uploads.length > 0) {
      const upResp = await chrome.tabs.sendMessage(tab.id, {
        type: "BEPZA_UPLOAD_DOCS", uploads,
      });
      statusEl.textContent = `✓ Filled ${resp.filledCount} field(s), uploaded ${upResp.uploadedCount} document(s). Review before submitting.`;
    } else {
      statusEl.textContent = `✓ Filled ${resp.filledCount} field(s). Review before submitting.`;
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Error: ${err.message || "Could not reach the page."}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Autofill BEPZA Form";
  }
});

/* ── Restore last saved data ─────────────────── */
chrome.storage.local.get("bepzaExtractedData", res => {
  if (res.bepzaExtractedData && Object.keys(res.bepzaExtractedData).length) {
    extractedData = res.bepzaExtractedData;
    renderReviewTable(extractedData);
    document.getElementById("review-section").classList.remove("hidden");
  }
});
