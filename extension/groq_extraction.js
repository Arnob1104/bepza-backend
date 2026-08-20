/* groq_extraction.js — calls OUR backend for AI extraction, then applies
 * hardcoded business rules. The file name and the GROQ_* naming below are
 * kept intentionally (per project convention) even though the actual AI
 * provider is configured only on the backend and never appears here —
 * these names are just labels, not something this file relies on for
 * security. See auth.js for the actual authenticated request logic.
 */

// Retries on 429 (rate limit) and 503 (temporary overload) with exponential
// backoff, mirroring what the backend itself already retries on when
// talking to the AI provider — this covers the case where OUR backend is
// briefly rate-limiting or restarting, not the AI provider directly.
async function callGroq(docType, userText, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  let response;
  try {
    response = await authFetch("/api/extract", {
      method: "POST",
      body: JSON.stringify({ doc_type: docType, text: userText.slice(0, 12000) }),
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err; // let the caller show the login screen
    throw new Error(`Could not reach the extraction service: ${err.message}`);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if ((response.status === 503 || response.status === 429) && attempt < MAX_ATTEMPTS) {
      const waitMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
      await new Promise(r => setTimeout(r, waitMs));
      return callGroq(docType, userText, attempt + 1);
    }
    throw new Error(err.detail || `Extraction failed (${response.status}).`);
  }

  const body = await response.json();
  return body.data || {};
}

/* ── Date normaliser → always DD/MM/YYYY ──────── */
function normalizeDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();

  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  const M = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
              jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };

  // DD-Mon-YYYY  or  DD/Mon/YYYY  e.g. 29-Jun-2026
  let m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{4})$/);
  if (m) {
    const mon = M[m[2].toLowerCase().slice(0,3)];
    if (mon) return `${m[1].padStart(2,"0")}/${mon}/${m[3]}`;
  }

  // DD-MM-YYYY or DD.MM.YYYY
  m = s.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
  if (m) return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[3]}`;

  // YYYY-MM-DD
  m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[3].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[1]}`;

  // Month DD, YYYY  e.g. June 29, 2026
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = M[m[1].toLowerCase().slice(0,3)];
    if (mon) return `${m[2].padStart(2,"0")}/${mon}/${m[3]}`;
  }

  // 01-JUL-2026 all caps
  m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (m) {
    const mon = M[m[2].toLowerCase()];
    if (mon) return `${m[1].padStart(2,"0")}/${mon}/${m[3]}`;
  }

  return s; // return as-is if unparseable
}

/* ── HS Code map ──────────────────────────────── */
const HS_CODE_MAP = {
  "9607.11.00": { code: "96071100", product: "ZIPPER" },
  "96071100":   { code: "96071100", product: "ZIPPER" },
  "9606.22.00": { code: "96062200", product: "BUTTON" },
  "96062200":   { code: "96062200", product: "BUTTON" },
};

function resolveHsCode(raw) {
  const clean = String(raw||"").trim();
  return HS_CODE_MAP[clean] || HS_CODE_MAP[clean.replace(/\./g,"")] || null;
}

/* ── EXP No: digits only ──────────────────────── */
function formatExpNo(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/* ─────────────────────────────────────────────────
   Per-document AI extractors
   The system prompt for each doc type used to be embedded here and sent
   directly to the AI provider from the browser. It now lives server-side
   (backend/services/prompts.py) — the extension only tells the backend
   which doc type this is; the backend adds the right instructions and
   calls the AI provider itself. Function names and the EXTRACTORS map
   below are unchanged so the rest of popup.js needs no changes.
   ───────────────────────────────────────────────── */

async function extractCommercialInvoice(text) {
  return callGroq("commercialInvoice", text);
}

async function extractEXP(text) {
  return callGroq("exp", text);
}

async function extractSalesContract(text) {
  return callGroq("salesContract", text);
}

async function extractUndertaking(text) {
  return callGroq("undertaking", text);
}

/* ── Merge all docs + apply ALL business rules ── */
// Coerces a value that should be a single-line string into one, even if the
// AI returns it as an array of address lines (e.g. ["Line 1", "Line 2"]) or
// a nested object — this previously caused "undefined:undefined" to render
// when the review-table formatter assumed the {product, code} shape.
function toFlatString(val) {
  if (val == null) return "";
  if (Array.isArray(val)) {
    return val
      .map(item => (typeof item === "string" ? item : (item?.text ?? item?.line ?? JSON.stringify(item))))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function mergeExtractions(perDoc) {
  const ci  = perDoc.commercialInvoice || {};
  const exp = perDoc.exp               || {};
  const sc  = perDoc.salesContract     || {};
  const ut  = perDoc.undertaking       || {};

  // Build products from CI products array
  let products = [];
  if (Array.isArray(ci.products) && ci.products.length) {
    products = ci.products.map(p => {
      const resolved = resolveHsCode(p.hsCode);
      return {
        code:      resolved?.code    || (p.hsCode||"").replace(/\./g,""),
        product:   (p.description || resolved?.product || "").toUpperCase(),
        quantity:  String(p.quantity||"").replace(/[^0-9.]/g,""), // digits only
        unit:      (p.unit||"PCS").toUpperCase(),
        netWeight: p.netWeight || ci.netWeight || "",
        fobValue:  p.fobValue  || "",
      };
    });
  } else {
    // Fallback: derive from SC HS code
    const resolved = resolveHsCode(sc.hsCode || "");
    if (resolved) {
      products = [{
        code: resolved.code, product: resolved.product,
        quantity: ci.quantity || "", unit: ci.unit || "PCS",
        netWeight: ci.netWeight || "", fobValue: sc.invoiceAmount || ci.invoiceAmount || "",
      }];
    }
  }

  // Issuing bank: prefer SC second-party bank, fall back to CI "Issued By"
  const issuingBank = sc.issuingBank || ci.issuedBy || "";

  return {
    // ── Basic Information ──
    undertakingNo:    ut.undertakingNo   || "",
    undertakingDate:  normalizeDate(ut.undertakingDate),
    invoiceNo:        ci.invoiceNo       || "",
    invoiceDate:      normalizeDate(ci.invoiceDate),
    typeOfCarrier:    "Road",                        // FIXED

    // ── Destination ──
    placeOfLoading:   "AEPZ NARAYANGONJ",            // FIXED
    portOfDest:       ci.portOfDest   || sc.portOfDest || "",
    consigneeName:    toFlatString(ci.consigneeName),
    consigneeAddress: toFlatString(ci.consigneeAddress),
    expNo:            formatExpNo(exp.expNo),         // digits only
    expDate:          normalizeDate(exp.expDate),
    netWeight:        ci.netWeight || "",

    // ── Export Details (per-product via products array) ──
    typeOfProducts:   "Garment Accessories",          // FIXED
    fobValue:         sc.invoiceAmount || ci.invoiceAmount || "",

    // ── LC/TT/PO/SC/CMT ──
    scNo:        sc.scNo        || ci.scNo || "",
    lcValue:     sc.invoiceAmount || ci.invoiceAmount || "",
    issuingDate: normalizeDate(sc.scDate),           // SC date = Issue Date
    issuingBank: issuingBank,
    lcType:      "Sales Contract",               // FIXED — matches dropdown option exactly
    expiryDate:  normalizeDate(sc.expiryDate),       // Validity = Expire Date

    // ── Products array (multi-row) ──
    hsCode:   products[0]?.code    || "",   // shown in review table + used as fallback
    products,
  };
}

/* ── Field labels for popup review table ──────── */
const FIELD_LABELS = {
  undertakingNo:    "Undertaking No.",
  undertakingDate:  "Undertaking Date (DD/MM/YYYY)",
  invoiceNo:        "Invoice/Vendor Reference No",
  invoiceDate:      "Invoice/Vendor Reference Date (DD/MM/YYYY)",
  typeOfCarrier:    "Type of Carrier [FIXED: Road]",
  placeOfLoading:   "Place of Loading [FIXED: AEPZ NARAYANGONJ]",
  portOfDest:       "Port of Destination (last line of Despatch Address)",
  consigneeName:    "Consignee Name",
  consigneeAddress: "Consignee Address (below company in Despatch Address)",
  expNo:            "EXP No. (digits only)",
  expDate:          "EXP Date (DD/MM/YYYY)",
  netWeight:        "Total Net Weight (Kg.)",
  hsCode:           "HS Code [e.g. 96071100 for ZIPPER, 96062200 for BUTTON]",
  typeOfProducts:   "Type of Products [FIXED: Garment Accessories]",
  fobValue:         "FOB Total USD Value",
  scNo:             "TT/P.O/SC/CMT/ LC No.",
  lcValue:          "TT/P.O/SC/CMT/ LC Value (US$)",
  issuingDate:      "Issue Date (DD/MM/YYYY) — from SC Date",
  issuingBank:      "Issuing Bank (SC 2nd party bank or CI Issued By)",
  lcType:           "Type [FIXED: Sales Contract]",
  expiryDate:       "Expire Date (DD/MM/YYYY) — from SC Validity",
};

const EXTRACTORS = {
  commercialInvoice: extractCommercialInvoice,
  exp:               extractEXP,
  salesContract:     extractSalesContract,
  undertaking:       extractUndertaking,
};
