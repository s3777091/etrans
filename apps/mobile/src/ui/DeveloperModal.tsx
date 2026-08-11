import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { InterpreterMetrics } from "../interpreter/engine";
import type { AppTheme } from "./theme";

interface DeveloperModalProps {
  visible: boolean;
  metrics: InterpreterMetrics;
  theme: AppTheme;
  onClose: () => void;
}

export function DeveloperModal({
  visible,
  metrics,
  theme,
  onClose,
}: DeveloperModalProps) {
  const isChineseInput = metrics.direction === "zh-to-vi";
  const rows = [
    ["Provider", metrics.provider],
    ["Current model", metrics.currentModel],
    ["Mode", metrics.mode],
    ["Input", isChineseInput ? "zh-Hans" : "vi"],
    ["Output", isChineseInput ? "vi" : "zh-Hans"],
    ["WebSocket RTT", formatMs(metrics.websocketRttMs)],
    ["First input transcript", formatMs(metrics.firstInputTranscriptMs)],
    [
      "First translated transcript",
      formatMs(metrics.firstTranslatedTranscriptMs),
    ],
    ["First translated audio", formatMs(metrics.firstTranslatedAudioMs)],
    ["PCM queue", `${metrics.pcmQueueMs} ms`],
    ["Dropped buffers", String(metrics.droppedBuffers)],
  ];

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>Developer</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>Live diagnostics</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Text style={[styles.closeText, { color: theme.text }]}>Đóng</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.panel,
              { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
            ]}
          >
            {rows.map(([label, value], index) => (
              <View
                key={label}
                style={[
                  styles.row,
                  index > 0 && { borderTopWidth: 1, borderTopColor: theme.border },
                ]}
              >
                <Text style={[styles.rowLabel, { color: theme.muted }]}>
                  {label}
                </Text>
                <Text style={[styles.rowValue, { color: theme.text }]}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "Waiting" : `${value} ms`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 76,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { marginTop: 3, fontSize: 13 },
  closeButton: {
    minWidth: 68,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 14, fontWeight: "700" },
  content: { padding: 18, paddingBottom: 40 },
  panel: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  row: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  rowLabel: { width: 124, fontSize: 13, lineHeight: 18 },
  rowValue: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
