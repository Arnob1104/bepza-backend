/* content_script.js
 * Uses direct label-text matching to fill BEPZA form fields.
 * No AI needed for form filling — labels are matched against a hardcoded map.
 */

/* ── Skip rules ──────────────────────────────────────────────────────── */
function shouldSkip(labelText, name, id) {
  const t = (labelText + " " + name + " " + id).toLowerCase();
  return /cm\s*value|percentage\s*\(us|%/.test(t);
}

/* ── Label extraction ─────────────────────────────────────────────────── */
function getLabelText(el) {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return lbl.textContent.trim().replace(/\s+/g, " ");
  }
  const pLabel = el.closest("label");
  if (pLabel) return pLabel.textContent.trim().replace(/\s+/g, " ");

  // Look for label-like text in parent containers
  const containers = [el.closest(".form-group"), el.closest("td"), el.closest("div")];
  for (const c of containers) {
    if (!c) continue;
    const lbl = c.querySelector("label");
    if (lbl && lbl.textContent.trim()) return lbl.textContent.trim().replace(/\s+/g, " ");
    // Preceding sibling text
    let sib = el.previousElementSibling;
    for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
      const t = sib.textContent && sib.textContent.trim().replace(/\s+/g, " ");
      if (t && t.length < 120) return t;
    }
    const txt = c.textContent.trim().replace(/\s+/g, " ");
    if (txt) return txt.slice(0, 120);
  }
  return "";
}

/* ── Label → extracted data key mapping ──────────────────────────────── */
// Pattern order matters — more specific first.
const LABEL_MAP = [
  // Basic Information
  { p: /undertaking\s*no/i,                          key: "undertakingNo"    },
  { p: /undertaking\s*date/i,                        key: "undertakingDate"  },
  { p: /invoice.*vendor.*ref.*no|vendor.*ref.*no/i,  key: "invoiceNo"        },
  { p: /invoice.*vendor.*ref.*date/i,                key: "invoiceDate"      },
  { p: /type\s*of\s*carrier/i,                       key: "typeOfCarrier"    },

  // Destination section
  { p: /place\s*of\s*loading/i,                      key: "placeOfLoading"   },
  { p: /port\s*of\s*destination/i,                   key: "portOfDest"       },
  { p: /consignee\s*name/i,                          key: "consigneeName"    },
  { p: /consignee\s*address/i,                       key: "consigneeAddress" },
  { p: /exp\s*no/i,                                  key: "expNo"            },
  { p: /exp\s*date/i,                                key: "expDate"          },

  // Export Details
  { p: /type\s*of\s*products/i,                      key: "typeOfProducts"   },
  { p: /product\s*description/i,                     key: "productDesc"      },
  { p: /fob|cnf|cir|crf|x-factor|ddu|free of cost/i,key: "fobValue"         },
  { p: /select\s*hs\s*code|hs\s*code/i,              key: "hsCode"           },
  { p: /^quantity$|^quantity\s/i,                    key: "quantity"         },
  { p: /unit\s*of\s*quantity/i,                      key: "unit"             },

  // LC/TT/PO/SC/CMT section — order matters: value before no
  { p: /tt.*po.*sc.*cmt.*lc\s*value|lc\s*value\s*\(us/i, key: "lcValue"     },
  { p: /tt.*po.*sc.*cmt.*lc\s*no|p\.o.*sc.*cmt/i,   key: "scNo"             },
  { p: /issue\s*date/i,                              key: "issuingDate"      },
  { p: /issuing\s*bank/i,                            key: "issuingBank"      },
  { p: /^type\s*\*?$|^type$/i,                       key: "lcType"           },
  { p: /expire\s*date/i,                             key: "expiryDate"       },

  // Net weight (basic section — same key, fill both)
  { p: /net\s*weight/i,                              key: "netWeight"        },
];

function matchLabel(labelText) {
  for (const { p, key } of LABEL_MAP) {
    if (p.test(labelText)) return key;
  }
  return null;
}

/* ── Native value setter (works with React/Angular) ──────────────────── */
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc  = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

/* ── Select2 filler ──────────────────────────────────────────────────── */
// AJAX-loaded select2: we click to open → type in search → click result.

async function fillSelect2Async(el, value) {
  const valueLower  = String(value).toLowerCase().trim();
  const valueDigits = valueLower.replace(/\D/g, "");   // "96071100"

  // 1. Try programmatic set if options are already loaded
  const existingMatch = Array.from(el.options).find(o =>
    (valueDigits && o.value.replace(/\D/g,"").startsWith(valueDigits)) ||
    (valueDigits && o.textContent.replace(/\D/g,"").startsWith(valueDigits)) ||
    o.textContent.trim().toLowerCase() === valueLower ||
    o.value.toLowerCase() === valueLower
  );
  if (existingMatch) {
    setNativeValue(el, existingMatch.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (window.jQuery) {
      try { window.jQuery(el).val(existingMatch.value).trigger("change"); } catch(_) {}
    }
    return true;
  }

  // 2. Open the select2 dropdown by clicking its rendered span
  const spanId   = `select2-${el.id}-container`;
  const spanEl   = document.getElementById(spanId);
  const trigger  = spanEl
    ? spanEl.closest(".select2-selection, .select2-container") || spanEl
    : el.closest(".select2-container") || el.nextElementSibling || el;
  trigger.click();
  await new Promise(r => setTimeout(r, 400));

  // 3. Find the open search box
  let searchBox = document.querySelector(".select2-container--open .select2-search__field");
  if (!searchBox) {
    // dropdown didn't open — try clicking the selection arrow
    const arrow = document.querySelector(`#select2-${el.id}-container`)?.closest(".select2-selection");
    if (arrow) { arrow.click(); await new Promise(r => setTimeout(r, 400)); }
    searchBox = document.querySelector(".select2-container--open .select2-search__field");
  }

  if (!searchBox) return false;

  // 4. Type the search string character-by-character so select2 sees each keystroke
  const searchVal = valueDigits || value;   // use digits e.g. "96071100"
  searchBox.focus();
  searchBox.value = "";

  for (const char of searchVal) {
    searchBox.value += char;
    searchBox.dispatchEvent(new Event("input",       { bubbles: true }));
    searchBox.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: char }));
    await new Promise(r => setTimeout(r, 50));
  }

  // 5. Wait for AJAX results (select2 typically debounces 300ms)
  await new Promise(r => setTimeout(r, 900));

  // 6. Click the first matching result
  const results = Array.from(document.querySelectorAll(
    ".select2-results__option:not(.select2-results__message)"
  ));
  const hit = results.find(r =>
    r.textContent.replace(/\D/g,"").startsWith(valueDigits) ||
    r.textContent.trim().toLowerCase().includes(valueLower)
  ) || results[0]; // fall back to first result if only one returned

  if (hit && !hit.classList.contains("select2-results__option--disabled")) {
    hit.click();
    await new Promise(r => setTimeout(r, 300));
    return true;
  }

  // Dismiss if nothing matched
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return false;
}


function fillSelect2(el, value) {
  // Call async version; content_script async handlers await it for product rows
  return fillSelect2Async(el, value);
}

/* ── Fill one element ─────────────────────────────────────────────────── */
function fillElement(el, value) {
  if (!value && value !== 0) return false;
  const str = String(value);

  if (el.tagName === "SELECT") {
    const isS2 = el.classList.contains("select2-hidden-accessible") ||
                 !!document.querySelector(`#select2-${el.id}-container`);
    if (isS2) return fillSelect2(el, str);

    const match = Array.from(el.options).find(o =>
      o.value.toLowerCase() === str.toLowerCase() ||
      o.textContent.trim().toLowerCase() === str.toLowerCase() ||
      o.textContent.trim().toLowerCase().includes(str.toLowerCase())
    );
    if (!match) return false;
    setNativeValue(el, match.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // Text / number / date input
  el.focus();
  setNativeValue(el, str);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
  return true;
}

/* ── Find all fillable inputs ─────────────────────────────────────────── */
function getFormElements() {
  return Array.from(document.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])," +
    "select, textarea"
  )).filter(el => el.offsetParent !== null);
}

/* ── Main autofill using label matching ─────────────────────────────── */
function autofillByLabels(data) {
  let filled = 0;
  const elements = getFormElements();

  for (const el of elements) {
    const label = getLabelText(el);
    const name  = (el.name || "").toLowerCase();
    const id    = (el.id   || "").toLowerCase();

    if (shouldSkip(label, name, id)) continue;

    const key = matchLabel(label) || matchLabel(name + " " + id);
    if (!key) continue;

    const value = data[key];
    if (!value) continue;

    if (fillElement(el, value)) filled++;
  }
  return filled;
}

/* ── Product rows: full per-product row filling ─────────────────────── */

function getNthVisible(selector, n) {
  return Array.from(document.querySelectorAll(selector))
    .filter(el => el.offsetParent !== null)[n] || null;
}

function firstMatch(...selectors) {
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    } catch(_) {}
  }
  return null;
}

async function fillProductRows(products, data) {
  if (!products || products.length === 0) return 0;
  let filled = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];

    if (i > 0) {
      const addBtn = Array.from(document.querySelectorAll("button, a, input[type=button]"))
        .find(b => /add\s*more|add\s*item|add\s*row|\+\s*add/i.test(b.textContent || b.value || ""));
      if (addBtn) { addBtn.click(); await new Promise(r => setTimeout(r, 1000)); }
    }

    // ── HS Code (select2 AJAX dropdown) — must await ──────────
    const hsEl = firstMatch(`#select_hsCode_${i}`, `[name="hsCode[${i}]"]`, `[name="hsCode_${i}"]`)
                 || getNthVisible("select[id*='hsCode'], select[name*='hsCode']", i);
    if (hsEl && p.code) {
      const ok = await fillSelect2Async(hsEl, p.code);
      if (ok) filled++;
      await new Promise(r => setTimeout(r, 400)); // let UI settle
    }

    // ── Product Description ───────────────────────────────────
    const descEl = firstMatch(
      `#productDescription_${i}`, `[name="productDescription[${i}]"]`,
      `[name="description[${i}]"]`, `[name="productDesc[${i}]"]`,
    ) || getNthVisible(
      "textarea[id*='roductDesc'], textarea[name*='roductDesc']," +
      "textarea[id*='escription'], textarea[name*='escription']," +
      "input[id*='roductDesc'], input[name*='roductDesc']", i);
    if (descEl && p.product) {
      descEl.focus();
      setNativeValue(descEl, p.product.toUpperCase());
      descEl.dispatchEvent(new Event("input",  { bubbles: true }));
      descEl.dispatchEvent(new Event("change", { bubbles: true }));
      descEl.blur();
      filled++;
    }

    // ── Net Weight ────────────────────────────────────────────
    const nwEl = firstMatch(`#netWeight_${i}`, `[name="netWeight[${i}]"]`)
                 || getNthVisible(
                   "input[id*='etWeight'], input[name*='etWeight']," +
                   "input[id*='net_weight'], input[name*='net_weight']", i);
    const nw = p.netWeight || data.netWeight || "";
    if (nwEl && nw) { if (fillElement(nwEl, nw)) filled++; }

    // ── Quantity ──────────────────────────────────────────────
    // Broaden search: look for any numeric input near "Quantity" label
    let qtyEl = firstMatch(`#quantity_${i}`, `[name="quantity[${i}]"]`, `[name="qty_${i}"]`);
    if (!qtyEl) {
      // Find by label text directly — scan all visible inputs
      const allInputs = Array.from(document.querySelectorAll("input[type=text], input[type=number], input:not([type])"))
        .filter(el => el.offsetParent !== null);
      // Skip inputs already matched (netWeight etc) — find one whose label says "Quantity"
      qtyEl = allInputs.find(el => {
        const lbl = getLabelText(el);
        return /^quantity\s*\*?$/i.test(lbl.trim()) || /^qty\s*\*?$/i.test(lbl.trim());
      }) || getNthVisible("input[id*='uantity'], input[name*='uantity']", i);
    }
    const qty = p.quantity || "";
    if (qtyEl && qty) { if (fillElement(qtyEl, qty)) filled++; }

    // ── Unit of Quantity ──────────────────────────────────────
    const unitEl = firstMatch(`#unit_${i}`, `#unitOfQty_${i}`, `[name="unit[${i}]"]`,
                              `[name="unitOfQuantity[${i}]"]`)
                   || getNthVisible("select[id*='nit'], select[name*='nit']", i);
    const unit = p.unit || "PCS";
    if (unitEl && unit) { if (fillElement(unitEl, unit)) filled++; }

    // ── FOB/USD Value ─────────────────────────────────────────
    const fobVal = p.fobValue || data.fobValue || "";
    const fobEl = firstMatch(`#fobValue_${i}`, `#usdValue_${i}`,
      `[name="fobValue[${i}]"]`, `[name="usdValue[${i}]"]`, `[name="invoiceValue[${i}]"]`)
      || getNthVisible(
        "input[id*='fob'], input[name*='fob'], input[id*='sdValue']," +
        "input[name*='sdValue'], input[id*='nvoiceValue']", i);
    if (fobEl && fobVal) { if (fillElement(fobEl, fobVal)) filled++; }
  }

  return filled;
}

/* ── Form scanner (for debug/options page) ────────────────────────────── */
function scanFormFields() {
  return getFormElements().map((el, idx) => {
    const label = getLabelText(el);
    if (el.id) {} else {
      el.setAttribute("data-bepza-idx", String(idx));
    }
    return {
      selector: el.id ? `#${CSS.escape(el.id)}` : `[data-bepza-idx="${idx}"]`,
      tag: el.tagName.toLowerCase(), type: el.type || "",
      name: el.name || "", id: el.id || "",
      placeholder: el.placeholder || "", label,
      matchedKey: matchLabel(label) || null,
      options: el.tagName === "SELECT"
        ? Array.from(el.options).map(o => o.textContent.trim()).slice(0, 40)
        : undefined,
    };
  });
}

/* ── Message listener ─────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "BEPZA_PING") {
    sendResponse({ alive: true });
    return true;
  }

  if (message.type === "BEPZA_SCAN_FORM") {
    sendResponse({ fields: scanFormFields() });
    return true;
  }


  if (message.type === "BEPZA_UPLOAD_DOCS") {
    const uploads = message.uploads || [];

    // Exact label patterns matched against first cell text only
    const ROW_PATTERNS = [
      { pattern: /commercial\s*invoice/i,  label: "Commercial Invoice" },
      { pattern: /packing\s*list/i,        label: "Packing list"       },
      { pattern: /exp\s*form/i,            label: "EXP form"           },
      { pattern: /t\.t[\s,]/i,            label: "T.T"                },
      { pattern: /undertaking/i,            label: "Undertaking"        },
      { pattern: /^others$/i,              label: "Others"             },
    ];

    function base64ToFile(b64, filename, type) {
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], filename, { type: type || "application/pdf" });
    }

    function attachFile(input, file) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch (e) { console.error("attachFile:", e); return false; }
    }

    // Scan <tr> rows, match by first-cell text only to avoid cross-contamination
    function buildRowMap() {
      const map = {};

      // Strategy 1: find all visible file inputs in page order,
      // then match each to its nearby label text
      const allFileInputs = Array.from(document.querySelectorAll("input[type='file']"))
        .filter(el => el.offsetParent !== null || el.style.display !== 'none');
      const allCheckboxes = Array.from(document.querySelectorAll("input[type='checkbox']"))
        .filter(el => el.offsetParent !== null || el.style.display !== 'none');

      // Try text-based row matching first (look at full row text, not just first cell)
      const allRows = Array.from(document.querySelectorAll("tr"));
      for (const row of allRows) {
        const rowText = row.textContent.trim().replace(/\s+/g, " ");
        for (const { pattern, label } of ROW_PATTERNS) {
          if (pattern.test(rowText) && !map[label]) {
            const fileInput = row.querySelector("input[type='file']");
            const cb        = row.querySelector("input[type='checkbox']");
            if (fileInput) { map[label] = { fileInput, cb }; }
            break;
          }
        }
      }

      // Strategy 2: ALWAYS fill missing entries using position order
      // Position order on BEPZA: CI, Packing, EXP, TT/SC, Undertaking, Others
      const ORDER = [
        "Commercial Invoice",
        "Packing list",
        "EXP form",
        "T.T",
        "Undertaking",
        "Others",
      ];

      // Get all file inputs (include hidden ones — Browse buttons often hide the real input)
      const allFileInputsIncHidden = Array.from(document.querySelectorAll("input[type='file']"));
      const allCheckboxesIncHidden = Array.from(document.querySelectorAll("input[type='checkbox']"))
        .filter(cb => {
          // only checkboxes in the supporting docs section
          const row = cb.closest("tr");
          return row && row.querySelector("input[type='file']");
        });

      if (allFileInputsIncHidden.length >= 2) {
        ORDER.forEach((label, i) => {
          if (!map[label] && allFileInputsIncHidden[i]) {
            map[label] = {
              fileInput: allFileInputsIncHidden[i],
              cb: allCheckboxesIncHidden[i] || null,
            };
          }
        });
      }

      // Strategy 3: look for label text near each file input as final fallback
      if (Object.keys(map).length === 0) {
        allFileInputs.forEach(fi => {
          const container = fi.closest("tr, li, div") || fi.parentElement;
          if (!container) return;
          const txt = container.textContent.trim().replace(/\s+/g, " ");
          for (const { pattern, label } of ROW_PATTERNS) {
            if (pattern.test(txt) && !map[label]) {
              const cb = container.querySelector("input[type='checkbox']");
              map[label] = { fileInput: fi, cb };
              break;
            }
          }
        });
      }

      console.log("BEPZA rowMap:", Object.keys(map));
      return map;
    }

    (async () => {
      const rowMap = buildRowMap();
      let uploadedCount = 0;
      for (const upload of uploads) {
        const entry = rowMap[upload.label];
        if (!entry) { console.warn("No row for:", upload.label, "| available:", Object.keys(rowMap)); continue; }
        if (entry.cb && !entry.cb.checked) { entry.cb.click(); await new Promise(r => setTimeout(r, 250)); }
        const file = base64ToFile(upload.data, upload.name, upload.type);
        if (attachFile(entry.fileInput, file)) uploadedCount++;
      }
      sendResponse({ uploadedCount });
    })();
    return true;
  }

    if (message.type === "BEPZA_AUTOFILL") {
    const { data, products } = message;

    // Step 1: fill all regular fields via label matching
    const regularFilled = autofillByLabels(data);

    // Step 2: fill product rows (may involve clicking "+ Add more")
    fillProductRows(products || [], data).then(productFilled => {
      sendResponse({ filledCount: regularFilled + productFilled });
    });

    return true; // keep channel open for async response
  }
});
