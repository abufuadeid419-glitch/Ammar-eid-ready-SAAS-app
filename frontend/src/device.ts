import * as Device from "expo-device";
import { Platform } from "react-native";

// A human label for the current device, shown in the "trusted devices" list.
export function deviceLabel(): string {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && /Mobi/i.test(navigator.userAgent)) return "متصفح على الجوال";
    return "متصفح الويب";
  }
  return Device.deviceName || Device.modelName || (Platform.OS === "ios" ? "جهاز iPhone" : "جهاز Android");
}

export const devicePlatform = () => Platform.OS;
