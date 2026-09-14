import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Buildings, Plus } from "phosphor-react-native";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Badge, Card, EmptyState, Loading, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { tradeLabel } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Projects() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch("/projects") });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch("/clients") });
  const list = data ?? [];

  const addProject = () => {
    haptic("light");
    if (!clients || clients.length === 0) {
      toast.show("Najpierw dodaj klienta", "info");
      router.push("/client-form");
      return;
    }
    router.push("/project-form");
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Inwestycje" subtitle={`${list.length} aktywnych`} />
      <FlatList
        data={list}
        keyExtractor={(i) => i.project_id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/project/${item.project_id}`)} testID={`project-${item.project_id}`}>
            <View style={{ gap: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
                <Badge label={tradeLabel(item.trade)} kind="info" />
              </View>
              <Text style={styles.sub} numberOfLines={1}>{item.client_name || "—"}</Text>
              {item.address ? <Text style={styles.addr} numberOfLines={1}>{item.address}</Text> : null}
            </View>
          </Card>
        )}
        ListEmptyComponent={
          isLoading ? <Loading /> : (
            <EmptyState icon={<Buildings size={56} color={colors.muted} weight="thin" />} title="Brak inwestycji" subtitle="Dodaj pierwszą inwestycję przyciskiem poniżej" testID="projects-empty" />
          )
        }
      />
      <Pressable onPress={addProject} style={[styles.fab, { bottom: 16 }]} testID="add-project-fab">
        <Plus size={22} color={colors.onBrandPrimary} weight="bold" />
        <Text style={styles.fabText}>DODAJ</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.onSurface, flex: 1 },
  sub: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  addr: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  fab: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 56 },
  fabText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },
}));
