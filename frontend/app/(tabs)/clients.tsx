import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Phone, Plus, User } from "phosphor-react-native";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Card, EmptyState, Loading, ScreenHeader, haptic } from "@/src/components/ui";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Clients() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch("/clients") });
  const list = data ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Klienci" subtitle={`${list.length} kontaktów`} />
      <FlatList
        data={list}
        keyExtractor={(i) => i.client_id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/client-form?id=${item.client_id}`)} testID={`client-${item.client_id}`} style={{ padding: 0 }}>
            <View style={styles.row}>
              <View style={styles.avatar}>
                <User size={24} color={colors.onSurface} weight="bold" />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {item.company ? <Text style={styles.sub} numberOfLines={1}>{item.company}</Text> : null}
                {item.phone ? (
                  <View style={styles.phoneRow}>
                    <Phone size={13} color={colors.muted} weight="bold" />
                    <Text style={styles.phone}>{item.phone}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          isLoading ? <Loading /> : (
            <EmptyState icon={<User size={56} color={colors.muted} weight="thin" />} title="Brak klientów" subtitle="Dodaj pierwszego klienta przyciskiem poniżej" testID="clients-empty" />
          )
        }
      />
      <Pressable onPress={() => { haptic("light"); router.push("/client-form"); }} style={styles.fab} testID="add-client-fab">
        <Plus size={22} color={colors.onBrandPrimary} weight="bold" />
        <Text style={styles.fabText}>DODAJ</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  avatar: { width: 48, height: 48, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  name: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  phone: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 56 },
  fabText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },
}));
