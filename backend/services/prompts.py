"""
prompts.py — the system prompts for each BEPZA document type.

These were moved here verbatim from the extension's groq_extraction.js so
extraction behavior is unchanged. They now live server-side only: the
extension sends just {doc_type, text} and never sees these prompts, which
also means the AI provider's exact request format is never exposed to it.
"""

COMMERCIAL_INVOICE_PROMPT = """You extract data from a Bangladeshi Commercial Invoice PDF.
Return ONLY a JSON object — no markdown, no extra keys.

{
  "invoiceNo":        "Invoice number after INVOICE # e.g. TZBD/2026-27/0894",
  "invoiceDate":      "Raw date after DATE: — return exactly as written e.g. 29-Jun-2026",
  "consigneeName":    "Company name — first line of DESPATCH ADDRESS section only",
  "consigneeAddress": "All address lines BELOW the company name in DESPATCH ADDRESS, joined into ONE plain string separated by commas (exclude company name line itself) — must be a single string, not an array",
  "portOfDest":       "LAST short line of DESPATCH ADDRESS showing city/area e.g. 'Savar, Dhaka, Bangladesh'",
  "lcNo":             "Value after LC NO.: (may be RTGS REF number)",
  "lcDate":           "Raw date after LC DATE: — return exactly as written",
  "issuedBy":         "Bank name after ISSUED BY: field e.g. THE HSBC LTD",
  "invoiceAmount":    "Grand total numeric value only e.g. 203.58",
  "invoiceCurrency":  "Currency code e.g. USD",
  "incoTerm":         "Trade/Inco term e.g. EX WORKS",
  "netWeight":        "Total net weight number only e.g. 18",
  "products": [
    {
      "hsCode":      "HS code for this product exactly as written e.g. 9607.11.00 or 9606.22.00",
      "description": "Product name UPPERCASE e.g. ZIPPER or BUTTON",
      "quantity":    "Total quantity for this product — NUMBER ONLY, no unit e.g. 2262 or 244",
      "unit":        "Unit of quantity — either PCS or GROSS exactly as written",
      "netWeight":   "Net weight for this product if given separately, otherwise use total",
      "fobValue":    "Total invoice value for this product e.g. 203.58"
    }
  ]
}

IMPORTANT:
- products array has ONE entry per distinct HS code / product type.
- quantity must be a plain number — no letters, no units appended.
- unit must be exactly PCS or GROSS (or whatever unit label appears next to the quantity total).
- Return dates exactly as they appear — do not reformat them.
- JSON only, no markdown."""

EXP_PROMPT = """Extract ONLY two fields from a Bangladesh Bank EXP Form. Return ONLY JSON:
{
  "expNo":   "Electronic Declaration No. — raw as written e.g. 23000501 /051466 /2026",
  "expDate": "Raw date next to declaration number — return exactly as written e.g. 01-JUL-2026"
}
JSON only."""

SALES_CONTRACT_PROMPT = """Extract from a Bangladeshi Sales Contract / SC document. Return ONLY JSON:
{
  "scNo":         "CONTRACT NO value e.g. TZBD/2026-27/0894/CUTTING",
  "scDate":       "The DATE value written just below the CONTRACT NO line — return exactly as written e.g. 29-Jun-2026",
  "issuingBank":  "SECOND PARTY bank name — labeled as '16) SECOND PARTYS BANK NAME' or similar e.g. THE HSBC LTD",
  "expiryDate":   "VALIDITY date value — return exactly as written e.g. 13-Aug-2026",
  "lastShipDate": "LAST DATE OF SHIPMENT value — return exactly as written",
  "portOfDest":   "PORT OF DESTINATION value",
  "hsCode":       "H.S CODE NO value e.g. 9607.11.00",
  "invoiceAmount":"TOTAL USD numeric value only e.g. 203.58"
}
IMPORTANT: scDate is the DATE field directly under the CONTRACT NO line.
JSON only."""

UNDERTAKING_PROMPT = """Extract from a Bangladeshi Export Undertaking letter. Return ONLY JSON:
{
  "undertakingNo":   "Reference number at the top e.g. TZBD/EP/AEPZ/2026-27/0894",
  "undertakingDate": "Date of the letter — return exactly as written e.g. 29-Jun-2026"
}
JSON only."""

PROMPTS_BY_DOC_TYPE = {
    "commercialInvoice": COMMERCIAL_INVOICE_PROMPT,
    "exp": EXP_PROMPT,
    "salesContract": SALES_CONTRACT_PROMPT,
    "undertaking": UNDERTAKING_PROMPT,
}
