import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Button, s } from "./ui";
import { errorMessage } from "./api";

WebBrowser.maybeCompleteAuthSession();
const tenant = process.env.EXPO_PUBLIC_ENTRA_TENANT_ID || "";
const clientId = process.env.EXPO_PUBLIC_ENTRA_CLIENT_ID || "";
const scope = process.env.EXPO_PUBLIC_ENTRA_API_SCOPE || "";
export const authConfigured = !!tenant && !!clientId && !!scope && !scope.includes("YOUR-");
export const redirectUri = process.env.EXPO_PUBLIC_ENTRA_REDIRECT_URI ||
  (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "sahayak://auth");
export interface Session { accessToken: string; expiresAt: number }

function useDiscovery(onError: (message: string) => void, revision: number) {
  const [discovery, setDiscovery] = useState<AuthSession.DiscoveryDocument | null>(null);
  useEffect(() => {
    let alive = true;
    const timeout = setTimeout(() => { if (alive) onError("Microsoft sign-in discovery is taking too long. Check your connection and retry sign-in configuration."); }, 30_000);
    void AuthSession.fetchDiscoveryAsync(`https://login.microsoftonline.com/${tenant}/v2.0`).then(value => {
      if (alive) setDiscovery(value);
    }).catch(error => { if (alive) onError(`Cannot load Microsoft sign-in: ${errorMessage(error)}`); })
      .finally(() => clearTimeout(timeout));
    return () => { alive = false; clearTimeout(timeout); };
  }, [onError, revision]);
  return discovery;
}
export function SignIn({ onSession, onError }: { onSession: (session: Session) => void; onError: (error: string) => void }) {
  const [revision, setRevision] = useState(0);
  const discovery = useDiscovery(onError, revision);
  const [busy, setBusy] = useState(false);
  const usedCode = useRef("");
  const [request, response, promptAsync] = AuthSession.useAuthRequest({
    clientId, redirectUri, scopes: ["openid", "profile", scope],
    responseType: AuthSession.ResponseType.Code, usePKCE: true
  }, discovery);
  useEffect(() => {
    if (!response) return;
    if (response.type === "error") { onError(response.error?.message || "Microsoft sign-in failed."); setBusy(false); return; }
    if (response.type !== "success") { setBusy(false); return; }
    const code = response.params.code;
    if (!code || code === usedCode.current || !discovery || !request?.codeVerifier) return;
    usedCode.current = code;
    const verifier = request.codeVerifier;
    setBusy(true);
    void AuthSession.exchangeCodeAsync({
      clientId, code, redirectUri, extraParams: { code_verifier: verifier }
    }, discovery).then(result => {
      onSession({ accessToken: result.accessToken, expiresAt: ((result.issuedAt || Date.now() / 1000) + (result.expiresIn || 3600)) * 1000 });
    }).catch(error => onError(errorMessage(error))).finally(() => setBusy(false));
  }, [response, discovery, request, onSession, onError]);
  return <View style={s.stack}>
    <Text style={s.muted}>Sign in with your organization to use the Azure-backed service. Tokens stay in memory only.</Text>
    <Button title={busy ? "Signing in…" : "Sign in with Microsoft"} disabled={!request || busy} onPress={() => {
      setBusy(true);
      void promptAsync().then(result => { if (result.type !== "success") setBusy(false); }).catch(error => { onError(errorMessage(error)); setBusy(false); });
    }} />
    {!discovery && <View style={s.stack}><Text style={s.caption}>Loading Microsoft sign-in configuration… If this persists, check tenant configuration and connection.</Text>
      <Button subtle title="Retry sign-in configuration" onPress={() => setRevision(value => value + 1)} /></View>}
  </View>;
}
