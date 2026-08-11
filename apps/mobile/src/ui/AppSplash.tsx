import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";

import type { AppTheme } from "./theme";

export const ETRANS_ICONS: Record<"light" | "dark", ImageSourcePropType> = {
  light: require("../../assets/branding/etrans-light.png"),
  dark: require("../../assets/branding/etrans-dark.png"),
};

interface AppSplashProps {
  visible: boolean;
  colorScheme: "light" | "dark";
  theme: AppTheme;
}

export function AppSplash({ visible, colorScheme, theme }: AppSplashProps) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.setValue(1);
      return;
    }

    Animated.timing(opacity, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, visible]);

  if (!mounted) return null;

  return (
    <Animated.View
      accessibilityLabel="Đang khởi động ETrans"
      accessibilityRole="progressbar"
      style={[
        styles.overlay,
        { backgroundColor: theme.background, opacity },
      ]}
    >
      <View style={styles.brand}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={ETRANS_ICONS[colorScheme]}
          style={styles.logo}
        />
        <Text style={[styles.name, { color: theme.text }]}>ETrans</Text>
      </View>
      <ActivityIndicator color={theme.accent} size="small" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    alignItems: "center",
    gap: 18,
    marginBottom: 34,
  },
  logo: {
    width: 148,
    height: 148,
  },
  name: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
});
