import { Linking } from "react-native";

// The ONLY contact number used anywhere in the app (support, payments, transfers, receipts, enquiries).
export const SUPPORT_WHATSAPP = "+963947744162";

export function openSupport(text?: string) {
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP.replace(/[^\d]/g, "")}${q}`);
}
