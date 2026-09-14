import { Tabs } from "expo-router";
import { Buildings, House, Package, Users } from "phosphor-react-native";
import { Platform } from "react-native";

import { fonts } from "@/src/lib/fonts";
import { useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 2,
          borderTopColor: colors.borderStrong,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Pulpit", tabBarIcon: ({ color, focused }) => <House size={24} color={color} weight={focused ? "fill" : "regular"} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: "Inwestycje", tabBarIcon: ({ color, focused }) => <Buildings size={24} color={color} weight={focused ? "fill" : "regular"} /> }}
      />
      <Tabs.Screen
        name="clients"
        options={{ title: "Klienci", tabBarIcon: ({ color, focused }) => <Users size={24} color={color} weight={focused ? "fill" : "regular"} /> }}
      />
      <Tabs.Screen
        name="catalog"
        options={{ title: "Baza", tabBarIcon: ({ color, focused }) => <Package size={24} color={color} weight={focused ? "fill" : "regular"} /> }}
      />
    </Tabs>
  );
}
