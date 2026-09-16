import { Image } from "expo-image";
import { Trash, X } from "phosphor-react-native";
import { useEffect, useRef, useState } from "react";
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/src/lib/fonts";
import { haptic } from "@/src/components/ui";

const { width, height } = Dimensions.get("window");

function ZoomImage({ uri, onZoomChange }: { uri: string; onZoomChange: (z: boolean) => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    sx.value = 0;
    sy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        reset();
        runOnJS(onZoomChange)(false);
      } else {
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = sx.value + e.translationX;
        ty.value = sy.value + e.translationY;
      }
    })
    .onEnd(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.01) {
        reset();
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Simultaneous(Gesture.Race(doubleTap, pan), pinch);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={styles.page}>
        <Animated.View style={[styles.imgWrap, aStyle]}>
          <Image source={{ uri }} style={styles.img} contentFit="contain" transition={120} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function PhotoViewer({
  visible,
  uris,
  initialIndex = 0,
  onClose,
  onDelete,
}: {
  visible: boolean;
  uris: string[];
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setZoomed(false);
    }
  }, [visible, initialIndex]);

  const total = uris.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <FlatList
          ref={listRef}
          data={uris}
          keyExtractor={(u, i) => `${u}-${i}`}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => <ZoomImage uri={item} onZoomChange={setZoomed} />}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn} testID="viewer-close">
            <X size={26} color="#FFFFFF" weight="bold" />
          </Pressable>
          {total > 1 ? (
            <Text style={styles.counter}>
              {index + 1} / {total}
            </Text>
          ) : (
            <View />
          )}
          {onDelete ? (
            <Pressable
              onPress={() => {
                haptic("medium");
                onDelete(index);
              }}
              hitSlop={12}
              style={styles.iconBtn}
              testID="viewer-delete"
            >
              <Trash size={24} color="#FFFFFF" weight="bold" />
            </Pressable>
          ) : (
            <View style={styles.iconBtn} />
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  page: { width, height, alignItems: "center", justifyContent: "center" },
  imgWrap: { width, height, alignItems: "center", justifyContent: "center" },
  img: { width, height },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  counter: { fontFamily: fonts.bodySemi, fontSize: 15, color: "#FFFFFF" },
});
