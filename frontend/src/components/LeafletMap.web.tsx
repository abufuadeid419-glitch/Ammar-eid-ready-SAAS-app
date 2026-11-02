import { createElement, useEffect, useRef } from "react";

// Web: Leaflet + OpenStreetMap/Esri tiles in an iframe — no Google Maps API key needed.
export function LeafletMap({ html, testID, onMarkerPress }: { html: string; testID?: string; onMarkerPress?: (id: string) => void }) {
  const ref = useRef<any>(null);
  const cb = useRef(onMarkerPress);
  cb.current = onMarkerPress;
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source && e.source === ref.current?.contentWindow && e.data?.leaflet) cb.current?.(String(e.data.leaflet));
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);
  return createElement("iframe", {
    key: html,
    ref,
    srcDoc: html,
    title: "الخريطة",
    "data-testid": testID,
    style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 },
  });
}
