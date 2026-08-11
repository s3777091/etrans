import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { CameraView } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AppTheme } from "./theme";

export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
}

interface CameraCaptureModalProps {
  visible: boolean;
  theme: AppTheme;
  onCaptured: (photo: CapturedPhoto) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export function CameraCaptureModal({
  visible,
  theme,
  onCaptured,
  onCancel,
  onError,
}: CameraCaptureModalProps) {
  const cameraRef = useRef<CameraView | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const captureStartedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const clearCaptureTimer = useCallback(() => {
    if (captureTimerRef.current !== undefined) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (visible) return;
    clearCaptureTimer();
    captureStartedRef.current = false;
    setReady(false);
  }, [clearCaptureTimer, visible]);

  useEffect(() => clearCaptureTimer, [clearCaptureTimer]);

  const capture = useCallback(async () => {
    if (!visible || captureStartedRef.current || !cameraRef.current) return;
    captureStartedRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.82,
        exif: false,
        skipProcessing: false,
        shutterSound: true,
      });
      if (!photo) throw new Error("Camera không trả về ảnh");
      onCaptured(photo);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Không thể chụp ảnh lúc này",
      );
    }
  }, [onCaptured, onError, visible]);

  const handleCameraReady = useCallback(() => {
    setReady(true);
    clearCaptureTimer();
    captureTimerRef.current = setTimeout(() => {
      void capture();
    }, 450);
  }, [capture, clearCaptureTimer]);

  const handleCancel = useCallback(() => {
    clearCaptureTimer();
    onCancel();
  }, [clearCaptureTimer, onCancel]);

  return (
    <Modal
      animationType="fade"
      statusBarTranslucent
      visible={visible}
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        {visible ? (
          <CameraView
            ref={cameraRef}
            active={visible}
            facing="back"
            mode="picture"
            onCameraReady={handleCameraReady}
            onMountError={({ message }) => onError(message)}
            style={StyleSheet.absoluteFill}
          />
        ) : null}

        <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
          <View style={styles.topBar}>
            <View style={styles.statusPill}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: ready ? theme.success : theme.accent },
                ]}
              />
              <Text style={styles.statusText}>
                {ready ? "Đang chụp để dịch" : "Đang mở camera"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Đóng camera"
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleCancel}
              style={({ pressed }) => [
                styles.closeButton,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <MaterialIcons name="close" size={25} color="#FFFFFF" />
            </Pressable>
          </View>

          <View pointerEvents="none" style={styles.guideArea}>
            <View style={styles.guideFrame} />
            <Text style={styles.guideText}>
              Đưa phần chữ cần dịch vào trong khung
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050606" },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "space-between",
  },
  topBar: {
    paddingHorizontal: 18,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusPill: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 21,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(5, 6, 6, 0.72)",
  },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5, 6, 6, 0.72)",
  },
  guideArea: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  guideFrame: {
    width: "100%",
    aspectRatio: 1.25,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.86)",
    backgroundColor: "rgba(0, 0, 0, 0.05)",
  },
  guideText: {
    marginTop: 18,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 17,
    overflow: "hidden",
    color: "#FFFFFF",
    backgroundColor: "rgba(5, 6, 6, 0.72)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
