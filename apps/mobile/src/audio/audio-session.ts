import { AudioManager } from "react-native-audio-api";
import { Platform } from "react-native";

/**
 * The interpreter records and speaks at the same time, so iOS puts the audio
 * session in `playAndRecord`. That category sends output to the receiver --
 * the earpiece you hold to your ear -- unless `defaultToSpeaker` is asked for,
 * which is why the translation arrived as text but was never heard.
 *
 * expo-audio owns the recording side of the session and re-applies its own
 * options whenever the microphone starts, so this runs again after every
 * stream start rather than once at launch.
 */
export async function configurePlaybackRouting(): Promise<void> {
  if (Platform.OS !== "ios") return;
  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "spokenAudio",
    iosOptions: [
      "defaultToSpeaker",
      "allowBluetoothA2DP",
      "allowBluetoothHFP",
      "allowAirPlay",
    ],
  });
  await AudioManager.setAudioSessionActivity(true);
}
