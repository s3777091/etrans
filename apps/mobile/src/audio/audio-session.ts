import { AudioManager } from "react-native-audio-api";
import { Platform } from "react-native";

/**
 * expo-audio deactivates the whole AVAudioSession when the microphone stops,
 * and the spoken translation arrives a moment later -- into a session that is
 * no longer running, which is why the text appeared and nothing was heard.
 *
 * An active playAndRecord session is held against the entire phone, so this is
 * claimed for the length of one spoken answer and handed straight back. Held
 * any longer -- across a turn, or from launch -- it takes the speaker away
 * from every other app: a call in another app reports a broken speaker while
 * ETrans merely sits in the background.
 *
 * The category matches the one the patched expo-audio recorder installs, so
 * the two never fight: voiceChat carries the echo cancellation that stops the
 * microphone hearing our own translation back, and defaultToSpeaker keeps
 * playAndRecord off the earpiece.
 */
export async function activatePlaybackSession(): Promise<void> {
  if (Platform.OS !== "ios") return;
  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "voiceChat",
    iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
    iosNotifyOthersOnDeactivation: true,
  });
  await AudioManager.setAudioSessionActivity(true);
}

/** Give the speaker back the moment the answer has finished speaking. */
export async function releasePlaybackSession(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await AudioManager.setAudioSessionActivity(false);
}
