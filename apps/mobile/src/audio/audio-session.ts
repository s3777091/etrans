import { AudioManager } from "react-native-audio-api";
import { Platform } from "react-native";

/**
 * expo-audio deactivates the whole AVAudioSession when the microphone stops
 * (`setActive(false)` in its AudioStream), and the spoken translation arrives
 * a moment after the speaker releases -- into a session that is no longer
 * running. The text appeared and nothing was ever heard.
 *
 * Reactivating it is the whole job. The category deliberately matches the one
 * the patched expo-audio recorder installs: `voiceChat` carries the echo
 * cancellation that stops the microphone hearing our own translation back, and
 * `defaultToSpeaker` keeps playAndRecord off the earpiece.
 */
export async function activatePlaybackSession(): Promise<void> {
  if (Platform.OS !== "ios") return;
  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "voiceChat",
    iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
  });
  await AudioManager.setAudioSessionActivity(true);
}
