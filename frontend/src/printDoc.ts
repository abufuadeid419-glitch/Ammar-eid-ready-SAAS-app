import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { RECEIPT_MM, ReceiptDoc } from "@/src/receipts";

// expo-print sizes are in points (1/72 inch): 80mm wide, estimated height -> one continuous strip.
const PT_PER_MM = 72 / 25.4;
const size = (d: ReceiptDoc) => ({ width: Math.round(RECEIPT_MM * PT_PER_MM), height: Math.round(d.heightMm * PT_PER_MM) });

export async function printReceipt(d: ReceiptDoc) {
  await Print.printAsync({ html: d.html, ...size(d) });
}

async function makePdf(d: ReceiptDoc) {
  try {
    return (await Print.printToFileAsync({ html: d.html, ...size(d), ...(Platform.OS === "ios" ? { margins: { left: 0, right: 0, top: 0, bottom: 0 } } : {}) })).uri;
  } catch {
    // Some Android WebViews reject custom media sizes — fall back to the default page size.
    return (await Print.printToFileAsync({ html: d.html })).uri;
  }
}

// Android share targets (WhatsApp, Drive…) need a real .pdf file name; Print's random cache name is
// copied to "<title>.pdf" in the cache dir that expo-sharing's FileProvider exposes.
function namedCopy(uri: string, title: string) {
  try {
    const name = `${title.replace(/[\\/:*?"<>|#%]+/g, "-").trim().slice(0, 60) || "document"}.pdf`;
    const dest = new File(Paths.cache, name);
    if (dest.exists) dest.delete();
    new File(uri).copySync(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

export async function shareReceipt(d: ReceiptDoc, title: string) {
  let uri = await makePdf(d);
  if (Platform.OS === "android") uri = namedCopy(uri, title);
  if (!(await Sharing.isAvailableAsync())) {
    // No share sheet: open the system print dialog, which offers "Save as PDF".
    await Print.printAsync({ uri });
    return;
  }
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
}

// Full-page (A4) HTML document → PDF → share sheet (used for the organization backup).
export async function shareHtmlPdf(html: string, title: string) {
  let uri = (await Print.printToFileAsync({ html })).uri;
  if (Platform.OS === "android") uri = namedCopy(uri, title);
  if (!(await Sharing.isAvailableAsync())) return Print.printAsync({ uri });
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
}
