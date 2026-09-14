import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CaretRight, ClipboardText, GearSix, Plus } from "phosphor-react-native";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Badge, Card, EmptyState, Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { pln, statusLabel } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data: estimates, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["estimates"],
    queryFn: () => apiFetch("/estimates"),
  });

  const list = estimates ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={`Cześć, ${(user?.name || "").split(" ")[0] || "wykonawco"}`}
        subtitle={user?.company_name || "BudKoszt Pro"}
        right={
          <Pressable onPress={() => { haptic("light"); router.push("/settings"); }} hitSlop={10} testID="open-settings">
            <GearSix size={26} color={colors.onSurface} weight="bold" />
          </Pressable>
        }
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.estimate_id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 4 }}>
            <Pressable
              onPress={() => { haptic("medium"); router.push("/(tabs)/projects"); }}
              style={({ pressed }) => [styles.bigCta, { opacity: pressed ? 0.9 : 1 }]}
              testID="new-estimate-cta"
            >
              <View style={styles.bigCtaIcon}>
                <Plus size={28} color={colors.onBrandPrimary} weight="bold" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigCtaTitle}>NOWA WYCENA</Text>
                <Text style={styles.bigCtaSub}>Zdjęcia + AI → gotowy kosztorys</Text>
              </View>
              <CaretRight size={24} color={colors.onBrandPrimary} weight="bold" />
            </Pressable>
            <Text style={styles.sectionTitle}>OSTATNIE WYCENY</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/estimate/${item.estimate_id}`)} testID={`estimate-${item.estimate_id}`} style={{ padding: 0 }}>
            <View style={styles.estRow}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.estTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.estSub} numberOfLines={1}>{item.client_name || "—"} · {item.project_name || "—"}</Text>
                <Badge label={statusLabel(item.status)} kind={item.status === "accepted" ? "success" : item.status === "sent" ? "info" : "neutral"} />
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Money style={styles.estAmount}>{pln(item.totals?.gross)}</Money>
                <Text style={styles.estNet}>brutto</Text>
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          isLoading ? (
            <Loading testID="dashboard-loading" />
          ) : (
            <EmptyState
              icon={<ClipboardText size={56} color={colors.muted} weight="thin" />}
              title="Brak wycen"
              subtitle="Zacznij od przycisku „Nowa wycena” powyżej"
              testID="dashboard-empty"
            />
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  bigCta: { backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 },
  bigCtaIcon: { width: 52, height: 52, borderWidth: 2, borderColor: colors.onBrandPrimary, alignItems: "center", justifyContent: "center" },
  bigCtaTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.onBrandPrimary, letterSpacing: -0.5 },
  bigCtaSub: { fontFamily: fonts.body, fontSize: 13, color: colors.onBrandPrimary, opacity: 0.9, marginTop: 2 },
  sectionTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  estRow: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  estTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  estSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  estAmount: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface },
  estNet: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textTransform: "uppercase" },
}));
