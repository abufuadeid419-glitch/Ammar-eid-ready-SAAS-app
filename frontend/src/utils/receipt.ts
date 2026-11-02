// Pick / read / open payment receipts (JPG, PNG, WebP, PDF). The server re-validates content.
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export type PickedFile = { uri: string; name: string; type: string; size: number; base64: string };
const OK = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",").pop() as string);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  return await new File(uri).base64();
}

const check = (f: PickedFile, maxMb: number) => {
  if (!OK.includes(f.type)) throw new Error("الصيغ المسموحة: JPG, PNG, WebP, PDF");
  if (f.size > maxMb * 1024 * 1024) throw new Error(`حجم الملف أكبر من ${maxMb}MB`);
  return f;
};

export async function pickReceiptImage(maxMb: number): Promise<PickedFile | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const base64 = a.base64 ?? (await readBase64(a.uri));
  const type = a.mimeType ?? "image/jpeg";
  return check({ uri: a.uri, name: a.fileName ?? "receipt.jpg", type, size: Math.round((base64.length * 3) / 4), base64 }, maxMb);
}

export async function pickReceiptPdf(maxMb: number): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const base64 = await readBase64(a.uri);
  return check({ uri: a.uri, name: a.name ?? "receipt.pdf", type: "application/pdf", size: a.size ?? Math.round((base64.length * 3) / 4), base64 }, maxMb);
}

// Open a PDF data URI (received over an authenticated request) without any public link.
export async function openPdfDataUri(dataUri: string) {
  if (Platform.OS === "web") {
    const blob = await (await fetch(dataUri)).blob();
    window.open(URL.createObjectURL(blob), "_blank");
    return;
  }
  const f = new File(Paths.cache, `receipt-${Date.now()}.pdf`);
  f.write(dataUri.split(",").pop() as string, { encoding: "base64" });
  await Sharing.shareAsync(f.uri, { mimeType: "application/pdf" });
}
