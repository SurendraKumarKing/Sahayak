import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Speech from "expo-speech";
import type { AssistantReply, TranscriptionResponse } from "@sahayak/shared";
import { audioUri, clearCache, readUpload } from "./files";
import { errorMessage, request, transcriptionSchema } from "./api";
import { Button, ExternalLink, Input, s } from "./ui";

export function useVoice(onError: (message: string) => void) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const cache = useRef<string | null>(null);
  const webAudio = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const stop = useCallback(async () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    setLoading(false);
    setPlayingId(null);
    if (webAudio.current) {
      webAudio.current.onended = null;
      webAudio.current.onerror = null;
      webAudio.current.pause();
      webAudio.current.removeAttribute("src");
      webAudio.current.load();
      webAudio.current = null;
    }
    player.pause();
    player.replace(null);
    const previous = cache.current;
    cache.current = null;
    await Speech.stop();
    if (previous) await clearCache(previous);
  }, [player]);
  const replay = useCallback(async (reply: AssistantReply, deviceOnly = false) => {
    const turn = generation.current + 1;
    try {
      await stop();
      if (turn !== generation.current) return;
      setPlayingId(reply.id);
      if (!deviceOnly && reply.speech.mode === "azure" && reply.speech.audioBase64) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = await audioUri(reply.speech.audioBase64);
        if (turn !== generation.current) { await clearCache(uri); return; }
        cache.current = uri;
        if (Platform.OS === "web") {
          const audio = new Audio(uri);
          webAudio.current = audio;
          audio.onended = () => { void stop().catch(error => onError(errorMessage(error))); };
          audio.onerror = () => {
            onError("The browser could not decode this audio. Try device read-aloud.");
            void stop().catch(error => onError(errorMessage(error)));
          };
          await audio.play();
          return;
        }
        player.replace({ uri });
        setLoading(true);
        timer.current = setTimeout(() => {
          if (generation.current === turn) {
            void stop().catch(error => onError(errorMessage(error)));
            onError("Audio did not start. Try Replay or the explicit device read-aloud fallback.");
          }
        }, 15_000);
      } else if (deviceOnly || reply.speech.mode === "device") {
        const voices = await Speech.getAvailableVoicesAsync();
        if (turn !== generation.current) return;
        const voice = voices.find(item => item.language.toLowerCase().split("-")[0] === reply.language.toLowerCase().split("-")[0]);
        if (!voice) throw new Error(`No device voice is installed for ${reply.language}. Install a matching voice or use Azure speech.`);
        Speech.speak(reply.text, {
          language: reply.language, voice: voice.identifier,
          onDone: () => { if (turn === generation.current) setPlayingId(null); },
          onStopped: () => { if (turn === generation.current) setPlayingId(null); },
          onError: error => { if (turn === generation.current) { setPlayingId(null); onError(errorMessage(error)); } }
        });
      } else {
        throw new Error(reply.speech.error || "Azure voice is unavailable. Choose device read-aloud to use an installed voice.");
      }
    } catch (error) {
      if (turn !== generation.current) return;
      await stop().catch(cleanupError => onError(errorMessage(cleanupError)));
      onError(errorMessage(error));
    }
  }, [stop, player, onError]);
  useEffect(() => {
    if (Platform.OS !== "web" && loading && status.isLoaded && player.isLoaded) {
      if (timer.current) clearTimeout(timer.current);
      setLoading(false);
      try {
        player.play();
        timer.current = setTimeout(() => {
          if (!player.playing) {
            onError("Playback could not start. Try Replay or device read-aloud.");
            void stop().catch(error => onError(errorMessage(error)));
          }
        }, 5000);
      } catch (error) { onError(errorMessage(error)); }
    }
    if (status.didJustFinish) void stop().catch(error => onError(errorMessage(error)));
  }, [status.isLoaded, status.didJustFinish, loading, player, stop, onError]);
  useEffect(() => () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (webAudio.current) {
      webAudio.current.onended = null;
      webAudio.current.onerror = null;
      webAudio.current.pause();
      webAudio.current.removeAttribute("src");
      webAudio.current.load();
    }
    void Speech.stop().catch(() => undefined);
    if (cache.current) void clearCache(cache.current).catch(() => undefined);
  }, []);
  return { replay, stop, playingId };
}
export type VoiceController = ReturnType<typeof useVoice>;
export function Reply({ reply, voice, onError, disabled }: { reply: AssistantReply; voice: VoiceController; onError: (message: string) => void; disabled?: boolean }) {
  const rtl = /^(ar|ur|fa|he)(-|$)/.test(reply.language);
  return <View style={s.reply}>
    <View style={s.row}><Text style={s.eyebrow}>SAHAYAK</Text><Text style={s.caption}>{reply.language.toUpperCase()} · {reply.speech.mode === "azure" ? "Azure voice" : reply.speech.mode === "device" ? "Device read-aloud" : "Voice unavailable"}</Text></View>
    <Text selectable style={[s.replyText, rtl && s.rtl]}>{reply.text}</Text>
    <View style={s.row}>
      <Button subtle title={voice.playingId === reply.id ? "Replay voice ↻" : "Replay voice ▷"} disabled={disabled} onPress={() => { void voice.replay(reply); }} />
      <Button subtle title="Stop ■" disabled={voice.playingId !== reply.id} onPress={() => { void voice.stop().catch(error => onError(errorMessage(error))); }} />
      {reply.speech.mode !== "device" && <Button subtle title="Device read-aloud" disabled={disabled} onPress={() => { void voice.replay(reply, true); }} />}
    </View>
    {!!reply.speech.error && <Text style={s.noticeText}>{reply.speech.error}</Text>}
    {reply.citations.map((citation, index) => citation.url
      ? <ExternalLink key={`${citation.title}-${index}`} title={citation.title} url={citation.url} onError={onError} />
      : <Text key={`${citation.title}-${index}`} style={s.caption}>Source: {citation.title}</Text>)}
  </View>;
}

export function VoiceInput({ enabled, token, target, onTarget, onTranscript, onError, stopPlayback, onRecording, disabled }: {
  enabled: boolean; token?: string; target: "chat" | "form"; onTarget: (target: "chat" | "form") => void;
  onTranscript: (result: TranscriptionResponse, target: "chat" | "form") => void; onError: (message: string) => void;
  stopPlayback: () => Promise<void>; onRecording: (recording: boolean) => void; disabled: boolean;
}) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 96000, web: { mimeType: "audio/webm", bitsPerSecond: 96000 } },
    status => { if (status.hasError) onError(status.error || "Recording failed. You can type instead."); });
  const state = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  const [localeInput, setLocaleInput] = useState("en-IN, hi-IN, te-IN, ta-IN");
  const capturedLocales = useRef<string[]>([]);
  const transition = useRef(false);
  const active = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedTarget = useRef(target);
  const finish = async () => {
    if (!active.current) return;
    active.current = false;
    transition.current = true;
    if (limit.current) clearTimeout(limit.current);
    setBusy(true);
    let uri: string | null = null;
    try {
      if (recorder.isRecording) await recorder.stop();
      uri = recorder.uri;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!uri) throw new Error("No recording was created. Please try again.");
      const file = await readUpload(uri, Platform.OS === "web" ? "voice.webm" : "voice.m4a", Platform.OS === "web" ? "audio/webm" : "audio/mp4");
      const result = await request("/speech/transcribe", transcriptionSchema, token, "POST", { file, candidateLocales: capturedLocales.current });
      onTranscript(result, capturedTarget.current);
    } catch (error) { onError(errorMessage(error)); }
    finally {
      if (uri) await clearCache(uri).catch(error => onError(errorMessage(error)));
      setBusy(false);
      transition.current = false;
      onRecording(false);
    }
  };
  const start = async () => {
    if (transition.current || active.current || disabled || !enabled) return;
    transition.current = true;
    setBusy(true);
    onRecording(true);
    try {
      const locales = [...new Set(localeInput.split(",").map(value => value.trim()).filter(Boolean))];
      if (!locales.length || locales.length > 4 || locales.some(value => !/^[a-z]{2,3}-[A-Z]{2}$/.test(value))) {
        throw new Error("Choose 1 to 4 Speech locales, separated by commas, such as en-IN, hi-IN, or kn-IN.");
      }
      capturedLocales.current = locales;
      await stopPlayback();
      if (Platform.OS === "web" && (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported("audio/webm"))) {
        throw new Error("This browser does not support WebM voice recording. Try current Chrome or Edge, or type your message.");
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission was denied. You can always type instead.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      capturedTarget.current = target;
      recorder.record(Platform.OS === "web" ? undefined : { forDuration: 60 });
      active.current = true;
      limit.current = setTimeout(() => { void finish(); }, 59_500);
    } catch (error) { onError(errorMessage(error)); onRecording(false); }
    finally { transition.current = false; setBusy(false); }
  };
  useEffect(() => () => {
    if (limit.current) clearTimeout(limit.current);
    if (active.current) void recorder.stop().then(async () => { if (recorder.uri) await clearCache(recorder.uri); }).catch(() => undefined);
  }, [recorder]);
  return <View style={s.stack}>
    <Text style={s.title}>Speak, then review</Text>
    <Text style={s.caption}>Up to 60 seconds · 6 MB. Transcription is added to your input, never sent as an application.</Text>
    <Input label="Possible spoken languages (locale codes)" value={localeInput} onChangeText={setLocaleInput}
      editable={enabled && !busy && !state.isRecording} maxLength={60} />
    <Text style={s.caption}>Auto-detect among up to four Azure Speech languages. Replace these codes for other languages, for example kn-IN, bn-IN, fr-FR, or es-ES. Availability depends on Speech support, separately from document translation.</Text>
    <View style={s.row}>
      <Button subtle selected={target === "chat"} title="To chat" disabled={busy || state.isRecording} onPress={() => onTarget("chat")} />
      <Button subtle selected={target === "form"} title="To draft" disabled={busy || state.isRecording} onPress={() => onTarget("form")} />
    </View>
    <Button title={state.isRecording ? `Stop & transcribe · ${Math.floor(state.durationMillis / 1000)}s` : busy ? "Processing voice…" : "Record voice"}
      disabled={busy || (!state.isRecording && (!enabled || disabled))} onPress={() => { void (state.isRecording ? finish() : start()); }} />
    {!enabled && <Text style={s.caption}>Voice recognition requires Azure mode, sign-in, and processing consent.</Text>}
  </View>;
}
