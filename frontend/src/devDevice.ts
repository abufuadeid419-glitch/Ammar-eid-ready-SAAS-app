import * as Crypto from "expo-crypto";

import { deviceLabel, devicePlatform } from "@/src/device";
import { storage } from "@/src/utils/storage";

const KEY = "dev_device_secret";

// Random per-install device secret (Keychain/Keystore on native). The server stores only its hash.
export async function devDevice() {
  let secret = (await storage.secureGet(KEY, null)) as string | null;
  if (!secret) {
    secret = Array.from(Crypto.getRandomBytes(32)).map((b) => b.toString(16).padStart(2, "0")).join("");
    await storage.secureSet(KEY, secret);
  }
  return { device_secret: String(secret), label: deviceLabel(), platform: devicePlatform() };
}
