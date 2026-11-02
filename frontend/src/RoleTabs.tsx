import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";

import { usesNativeTabs } from "@/src/navigation";
import { FloatingTabBar } from "@/src/components/FloatingTabBar";
import { GuidedTour } from "@/src/components/GuidedTour";
import { useTheme } from "@/src/theme";
import { IconName } from "@/src/ui";

export type TabDef = { name: string; title: string; icon: IconName; sf: string; desc?: string };

export function RoleTabs({ tabs, tourKey }: { tabs: TabDef[]; tourKey: string }) {
  const { colors } = useTheme();
  const tour = <GuidedTour tourKey={tourKey} tabs={tabs} />;
  if (usesNativeTabs) {
    return (
      <>
      <NativeTabs tintColor={colors.brandPrimary}>
        {tabs.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon sf={t.sf as any} />
            <NativeTabs.Trigger.Label>{t.title}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
      {tour}
      </>
    );
  }
  return (
    <>
    <Tabs
      tabBar={(props: any) => <FloatingTabBar {...props} icons={Object.fromEntries(tabs.map((t) => [t.name, t.icon]))} />}
      screenOptions={{ headerShown: false }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarButtonTestID: `tab-${t.name}`,
          }}
        />
      ))}
    </Tabs>
    {tour}
    </>
  );
}
