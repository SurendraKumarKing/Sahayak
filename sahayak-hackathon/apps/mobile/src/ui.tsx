import { useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

export const colors = {
  ink: "#202842", muted: "#58637A", indigo: "#3945A8", teal: "#086F67",
  paper: "#F6F5F0", white: "#FFFFFF", line: "#DCDDD9", pale: "#EAF4EF",
  danger: "#A42B32", amber: "#765010"
};
export function Button({ title, onPress, disabled, subtle, danger, selected, label }: {
  title: string; onPress: () => void; disabled?: boolean; subtle?: boolean; danger?: boolean; selected?: boolean; label?: string;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label || title}
    accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [s.button, subtle && s.subtle, selected && s.selected,
      danger && s.dangerButton, disabled && s.disabled, pressed && s.pressed, focused && s.focus]}>
    <Text style={[s.buttonText, subtle && s.subtleText, danger && s.dangerText]}>{title}</Text>
  </Pressable>;
}
export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }}
    disabled={disabled} onPress={() => onChange(!value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[s.toggle, focused && s.focus, disabled && s.disabled]}>
    <View style={[s.check, value && s.checked]}><Text style={s.checkText}>{value ? "✓" : ""}</Text></View>
    <Text style={[s.body, { flex: 1 }]}>{label}</Text>
  </Pressable>;
}
export function Input({ label, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return <View style={s.inputWrap}><Text style={s.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor="#727A8A"
      onFocus={event => { setFocused(true); props.onFocus?.(event); }}
      onBlur={event => { setFocused(false); props.onBlur?.(event); }}
      style={[s.input, props.multiline && s.multiline, focused && s.focus, props.style]} />
  </View>;
}
export function Card({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <View style={[s.card, accent && s.accentCard]}>{children}</View>;
}
export function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return <View style={s.section}>{!!eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
    <Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text>{children}</View>;
}
export function ExternalLink({ title, url, onError }: { title: string; url: string; onError: (message: string) => void }) {
  return <Button subtle title={`${title} ↗`} onPress={() => {
    if (!/^https:\/\//i.test(url)) { onError("Only secure HTTPS source links can be opened."); return; }
    void Linking.openURL(url).catch(() => onError("Could not open that source. Please try again."));
  }} />;
}
export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", padding: 24, gap: 22, paddingBottom: 60 },
  compactPage: { padding: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", paddingVertical: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 48, height: 48, backgroundColor: colors.indigo, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  logoText: { color: colors.white, fontSize: 29, fontWeight: "700" },
  brandTitle: { color: colors.ink, fontSize: 26, fontWeight: "800", letterSpacing: -0.7 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 24 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  row: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  stack: { gap: 14 },
  hero: { backgroundColor: "#E9ECE8", borderRadius: 26, padding: 28, gap: 12 },
  heroTitle: { color: colors.ink, fontSize: 38, lineHeight: 46, fontWeight: "800", letterSpacing: -1.2, maxWidth: 760 },
  heroCompact: { fontSize: 29, lineHeight: 36 },
  heroText: { color: colors.muted, fontSize: 16, lineHeight: 26, maxWidth: 700 },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" },
  badge: { backgroundColor: colors.pale, color: colors.teal, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, fontSize: 12, fontWeight: "800", overflow: "hidden" },
  demoBadge: { backgroundColor: "#FFF0CF", color: colors.amber },
  workspace: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  sidebar: { width: 280, gap: 16 },
  main: { flex: 1, minWidth: 0, gap: 16 },
  card: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 22, gap: 14 },
  accentCard: { backgroundColor: "#EFF5F2", borderColor: "#C7DCD3" },
  section: { gap: 6, paddingVertical: 4 },
  sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "700", lineHeight: 26 },
  button: { minHeight: 46, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 11, justifyContent: "center", alignItems: "center", backgroundColor: colors.indigo, borderWidth: 2, borderColor: "transparent" },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  subtle: { backgroundColor: "#F0F1F7", borderColor: "#E1E3EE" },
  subtleText: { color: colors.indigo },
  selected: { backgroundColor: "#E1E4FF", borderColor: colors.indigo },
  dangerButton: { backgroundColor: "#FCEDED", borderColor: "#EDC9CD" },
  dangerText: { color: colors.danger },
  focus: { borderColor: colors.teal, borderWidth: 2, ...(Platform.OS === "web" ? { outlineColor: colors.teal, outlineWidth: 2, outlineStyle: "solid" as const, outlineOffset: 3 } : {}) },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.75 },
  toggle: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, padding: 6, borderWidth: 2, borderColor: "transparent", borderRadius: 9 },
  check: { width: 24, height: 24, borderWidth: 2, borderColor: colors.muted, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkText: { color: colors.white, fontWeight: "800" },
  label: { color: colors.ink, fontSize: 13, fontWeight: "700", lineHeight: 20 },
  inputWrap: { gap: 7, flexGrow: 1 },
  input: { minHeight: 48, padding: 12, borderWidth: 2, borderColor: "#D6D9E2", borderRadius: 10, backgroundColor: "#FFFFFF", color: colors.ink, fontSize: 15, lineHeight: 22 },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  error: { padding: 16, borderRadius: 14, backgroundColor: "#FCEDED", borderWidth: 1, borderColor: "#E8BEC3", gap: 10 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 22 },
  notice: { backgroundColor: "#FFF5DC", padding: 14, borderRadius: 12, gap: 6 },
  noticeText: { color: colors.amber, fontSize: 13, lineHeight: 21 },
  reply: { borderLeftWidth: 3, borderLeftColor: colors.teal, paddingLeft: 16, gap: 12 },
  userBubble: { backgroundColor: "#EDEFFA", borderRadius: 16, padding: 18, marginLeft: 26, gap: 6 },
  replyText: { color: colors.ink, fontSize: 16, lineHeight: 27 },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  field: { padding: 16, gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: "#FAFAF8" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallPill: { color: colors.teal, fontSize: 12, fontWeight: "700", backgroundColor: colors.pale, padding: 7, borderRadius: 6 },
  footer: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 20 },
  progress: { flexDirection: "row", gap: 10, alignItems: "center", padding: 14, borderRadius: 12, backgroundColor: "#EDEFFA" }
});
