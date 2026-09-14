import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, CaretRight, MapPin, PencilSimple, User } from "phosphor-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Badge, Button, Card, EmptyState, Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { pln, statusLabel, tradeLabel } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => apiFetch(`/projects/${id}`) });

  if (isLoading || !data) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Inwestycja" back />
        <Loading />
      </View>
    );
  }

  const estimates = data.estimates ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={data.name}
        subtitle={tradeLabel(data.trade)}
        back
        right={
          <Pressable onPress={() => { haptic("light"); router.push(`/project-form?id=${id}`); }} hitSlop={10} testID="edit-project">
            <PencilSimple size={24} color={colors.onSurface} weight="bold" />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <Card>
          <View style={{ gap: 10 }}>
            {data.client ? (
              <View style={styles.infoRow}>
                <User size={18} color={colors.muted} weight="bold" />
                <Text style={styles.infoText}>{data.client.name}{data.client.company ? ` · ${data.client.company}` : ""}</Text>
              </View>
            ) : null}
            {data.address ? (
              <View style={styles.infoRow}>
                <MapPin size={18} color={colors.muted} weight="bold" />
                <Text style={styles.infoText}>{data.address}</Text>
              </View>
            ) : null}
            {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
          </View>
        </Card>

        <Button
          label="NOWA WYCENA AI"
          onPress={() => router.push(`/capture?projectId=${id}`)}
          icon={<Camera size={22} color={colors.onBrandPrimary} weight="bold" />}
          hapticKind="heavy"
          testID="start-capture"
        />

        <Text style={styles.section}>KOSZTORYSY ({estimates.length})</Text>
        {estimates.length === 0 ? (
          <EmptyState title="Brak kosztorysów" subtitle="Zrób zdjęcia i wygeneruj wycenę AI" testID="project-no-estimates" />
        ) : (
          estimates.map((e: any) => (
            <Card key={e.estimate_id} onPress={() => router.push(`/estimate/${e.estimate_id}`)} testID={`p-estimate-${e.estimate_id}`} style={{ padding: 0 }}>
              <View style={styles.estRow}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.estTitle} numberOfLines={1}>{e.title}</Text>
                  <Badge label={statusLabel(e.status)} kind={e.status === "accepted" ? "success" : e.status === "sent" ? "info" : "neutral"} />
                </View>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Money style={styles.amount}>{pln(e.totals?.gross)}</Money>
                  <Text style={styles.net}>brutto</Text>
                </View>
                <CaretRight size={20} color={colors.muted} weight="bold" />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface, flex: 1 },
  note: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 4 },
  section: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  estRow: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  estTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  amount: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.onSurface },
  net: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textTransform: "uppercase" },
}));
