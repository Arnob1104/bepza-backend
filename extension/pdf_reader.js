/* pdf_reader.js
 * Loads a PDF File object and returns its full plain text using pdf.js,
 * entirely client-side (no network / no API calls).
 */

let pdfjsReady = false;

function ensurePdfJs() {
  if (pdfjsReady) return;
  // pdfjsLib is exposed globally by lib/pdf.min.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
  pdfjsReady = true;
}

async function extractTextFromPdf(file) {
  ensurePdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n";
  }
  return fullText;
}
