import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";

import { useTheme } from "@/src/theme";

// Native: Leaflet + OpenStreetMap/Esri tiles inside a WebView — no Google Maps API key needed.
export function LeafletMap({ html, testID, onMarkerPress }: { html: string; testID?: string; onMarkerPress?: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <WebView
      key={html}
      testID={testID}
      originWhitelist={["*"]}
      source={{ html, baseUrl: "https://localhost/" }}
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      startInLoadingState
      onMessage={(e) => {
        try {
          const id = JSON.parse(e.nativeEvent.data)?.leaflet;
          if (id) onMarkerPress?.(String(id));
        } catch {}
      }}
      renderLoading={() => (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      )}
    />
  );
}
