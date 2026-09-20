import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, SafeAreaView, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import {
  SAMPLE_FORM, ProfileSchema, type AssistantReply, type HealthResponse, type LanguageOption,
  type SahayakDocument, type SchemeMatch, type Profile, type TranscriptionResponse
} from "@sahayak/shared";
import {
  API_URL, ApiError, deletedSchema, documentSchema, errorMessage, exportSchema, fillSchema,
  healthSchema, languagesSchema, replySchema, request, schemesSchema
} from "./src/api";
import { authConfigured, redirectUri, SignIn, type Session } from "./src/Auth";
import { clearCache, exportAnswers, readUpload, utf8Base64 } from "./src/files";
import { Button, Card, colors, ExternalLink, Input, s, Section, Toggle } from "./src/ui";
import { Reply, useVoice, VoiceInput } from "./src/Voice";

type Tab = "Chat" | "Schemes" | "Documents" | "Settings";
type Message = { role: "user"; id: string; text: string; language: string } | { role: "assistant"; reply: AssistantReply };
const occupations: NonNullable<Profile["occupation"]>[] = ["student", "farmer", "self-employed", "employed", "unemployed", "other"];
const initialLanguages: LanguageOption[] = [{ code: "en", name: "English", nativeName: "English" }];

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const [tab, setTab] = useState<Tab>("Chat");
  const [showControls, setShowControls] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(true);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const [languages, setLanguages] = useState<LanguageOption[]>(initialLanguages);
  const [languageError, setLanguageError] = useState("");
  const [languageVersion, setLanguageVersion] = useState(0);
  const [language, setLanguage] = useState("en");
  const [languageSearch, setLanguageSearch] = useState("");
  const [languageExpanded, setLanguageExpanded] = useState(false);
  const [autoLanguage, setAutoLanguage] = useState(true);
  const [autoplay, setAutoplay] = useState(false);
  const [consent, setConsent] = useState(false);
  const [demoConsent, setDemoConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const pendingRef = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const [retryLabel, setRetryLabel] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<"chat" | "form">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [documents, setDocuments] = useState<SahayakDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [docReply, setDocReply] = useState<AssistantReply | null>(null);
  const [expandedText, setExpandedText] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [age, setAge] = useState("");
  const [income, setIncome] = useState("");
  const [state, setState] = useState("");
  const [occupation, setOccupation] = useState<Profile["occupation"]>();
  const [farmland, setFarmland] = useState<"unknown" | "yes" | "no">("unknown");
  const [schemeReply, setSchemeReply] = useState<AssistantReply | null>(null);
  const [schemes, setSchemes] = useState<SchemeMatch[]>([]);
  const [hasMatched, setHasMatched] = useState(false);
  const reportError = useCallback((message: string) => setError(message), []);
  const clearPrivateState = useCallback(() => {
    setDocuments([]); setActiveId(null); setEvidenceId(null); setMessages([]);
    setDocReply(null); setSchemeReply(null); setSchemes([]); setHasMatched(false);
    setPrompt(""); setInstruction(""); setAge(""); setIncome(""); setState("");
    setOccupation(undefined); setFarmland("unknown");
    retry.current = null; setRetryLabel(""); setNotice(""); setError("");
  }, []);
  const onSession = useCallback((value: Session) => {
    clearPrivateState();
    setSession(value); setSessionNotice(""); retry.current = null; setRetryLabel(""); setError("");
  }, [clearPrivateState]);
  const voice = useVoice(reportError);
  const active = documents.find(item => item.id === activeId);
  const evidence = documents.find(item => item.id === evidenceId);
  const demo = health?.mode === "demo";
  const signedIn = !!session && session.expiresAt > Date.now();
  const ready = !!health && (demo || signedIn);
  const allowed = ready && (demo ? demoConsent : consent);
  const busy = !!pending || recording;
  const disabled = !allowed || busy;
  const selectedLanguage = languages.find(item => item.code === language);

  useEffect(() => {
    let alive = true;
    setConnecting(true);
    setConnectionError("");
    void request("/health", healthSchema).then(value => {
      if (alive) { setHealth(value); if (value.mode === "demo") setLanguage("en"); }
    }).catch(cause => { if (alive) { setHealth(null); setConnectionError(errorMessage(cause)); } })
      .finally(() => { if (alive) setConnecting(false); });
    return () => { alive = false; };
  }, [connectionVersion]);

  useEffect(() => {
    if (!health || (health.mode === "azure" && !session)) return;
    let alive = true;
    setLanguageError("");
    void request("/languages", languagesSchema, session?.accessToken).then(value => {
      if (!alive) return;
      const supported = health.mode === "demo" ? value.filter(item => item.code === "en") : value;
      setLanguages(supported.length ? supported : initialLanguages);
    }).catch(cause => { if (alive) setLanguageError(errorMessage(cause)); });
    return () => { alive = false; };
  }, [health, session, languageVersion]);

  useEffect(() => {
    if (!session) return;
    const remaining = session.expiresAt - Date.now() - 30_000;
    const timeout = setTimeout(() => {
      setSession(null);
      setConsent(false);
      clearPrivateState();
      setSessionNotice("Your session expired. Sign in again to continue.");
      void voice.stop().catch(cause => reportError(errorMessage(cause)));
    }, Math.max(0, remaining));
    return () => clearTimeout(timeout);
  }, [session, voice.stop, reportError, clearPrivateState]);

  async function api<T>(path: string, schema: z.ZodType<T>, method = "GET", body?: unknown): Promise<T> {
    if (!health) throw new Error("Connect to the API first.");
    if (health.mode === "azure" && (!session || session.expiresAt <= Date.now() + 30_000)) throw new Error("Sign in again before continuing.");
    if (!allowed) throw new Error(demo ? "Confirm that you will use fictional details in this demo." : "Confirm Azure processing consent before sending your data.");
    try { return await request(path, schema, session?.accessToken, method, body); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        clearPrivateState();
        setSession(null); setConsent(false); retry.current = null; setRetryLabel(""); setSessionNotice("Sign-in is required or expired.");
      }
      throw cause;
    }
  }
  function execute(label: string, action: () => Promise<void>, retryable = true) {
    if (pendingRef.current || recording) return;
    pendingRef.current = true;
    setPending(label);
    setError("");
    setNotice("");
    retry.current = retryable ? action : null;
    setRetryLabel(retryable ? label : "");
    void action().then(() => { retry.current = null; setRetryLabel(""); }).catch(cause => setError(errorMessage(cause)))
      .finally(() => { pendingRef.current = false; setPending(""); });
  }
  function receive(reply: AssistantReply) {
    if (autoLanguage && reply.language !== "und") setLanguage(reply.language);
    if (autoplay) void voice.replay(reply);
  }
  function rememberDocument(document: SahayakDocument) {
    setDocuments(current => current.some(item => item.id === document.id)
      ? current.map(item => item.id === document.id ? document : item) : [...current, document]);
  }
  function chooseDocument(id: string) {
    setActiveId(id); setDocReply(null); setExpandedText(false); setDeleteId(null);
    if (evidenceId === id) setEvidenceId(null);
  }
  function send() {
    const message = prompt.trim();
    if (!message) { setError("Type a question or record a voice message first."); return; }
    const history = messages.slice(-12).map(item => ({
      role: item.role, text: (item.role === "user" ? item.text : item.reply.text).slice(0, 8000)
    }));
    execute("Asking Sahayak", async () => {
      const reply = await api("/assistant", replySchema, "POST", {
        message, language, autoDetect: autoLanguage, history, ...(activeId ? { documentId: activeId } : {})
      });
      setMessages(current => [...current, { role: "user", id: `user-${reply.id}`, text: message, language }, { role: "assistant", reply }]);
      setPrompt(current => current.trim() === message ? "" : current);
      receive(reply);
    });
  }
  function upload(asEvidence = false) {
    execute(asEvidence ? "Uploading evidence" : "Reading your document", async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true, multiple: false
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("No file was selected.");
      try {
        const mimeType = asset.mimeType || (/\.pdf$/i.test(asset.name) ? "application/pdf" : /\.png$/i.test(asset.name) ? "image/png" : /\.jpe?g$/i.test(asset.name) ? "image/jpeg" : /\.txt$/i.test(asset.name) ? "text/plain" : "");
        if (!["text/plain", "application/pdf", "image/jpeg", "image/png"].includes(mimeType)) throw new Error("Choose a plain text, PDF, JPEG, or PNG file.");
        const file = await readUpload(asset.uri, asset.name, mimeType, asset.size);
        const document = await api("/documents", documentSchema, "POST", { file });
        rememberDocument(document);
        if (asEvidence) { setEvidenceId(document.id); setNotice("Evidence added. It will only be used when you choose Fill draft."); }
        else chooseDocument(document.id);
        setTab("Documents");
      } finally { await clearCache(asset.uri); }
    }, false);
  }
  function sample() {
    execute("Opening the sample form", async () => {
      const document = await api("/documents", documentSchema, "POST", {
        file: { name: "Sahayak-sample-form.txt", mimeType: "text/plain", base64: utf8Base64(SAMPLE_FORM) }
      });
      rememberDocument(document); chooseDocument(document.id); setTab("Documents");
    });
  }
  async function saveFields(document: SahayakDocument) {
    const saved = await api(`/documents/${document.id}/fields`, documentSchema, "PATCH", {
      fields: document.fields.map(({ id, value, confirmed }) => ({ id, value, confirmed }))
    });
    rememberDocument(saved);
    return saved;
  }
  function documentAction(action: "explain" | "translate") {
    if (!active) return;
    execute(action === "explain" ? "Explaining your document" : "Translating extracted text", async () => {
      const reply = await api(`/documents/${active.id}/${action}`, replySchema, "POST", { language });
      setDocReply(reply); receive(reply);
    });
  }
  function fill() {
    if (!active || !instruction.trim()) { setError("Add instructions before filling the draft."); return; }
    execute("Preparing your draft", async () => {
      await saveFields(active);
      const response = await api(`/documents/${active.id}/fill`, fillSchema, "POST", {
        instruction: instruction.trim(), language, ...(evidenceId ? { evidenceDocumentId: evidenceId } : {})
      });
      rememberDocument(response.document); setDocReply(response.reply); receive(response.reply);
      setNotice("Draft prepared. Check every provided answer and confirm it before export.");
    });
  }
  function matchSchemes() {
    execute("Finding potential scheme matches", async () => {
      if (age.trim() && !/^\d+$/.test(age.trim())) throw new Error("Age must be a whole number between 0 and 120.");
      if (income.trim() && !/^\d+(\.\d{1,2})?$/.test(income.trim())) throw new Error("Income must be a nonnegative number, without commas or currency symbols.");
      const parsed = ProfileSchema.safeParse({
        ...(age.trim() ? { age: Number(age) } : {}),
        ...(income.trim() ? { annualIncome: Number(income) } : {}),
        ...(state.trim() ? { state: state.trim() } : {}),
        ...(occupation ? { occupation } : {}),
        ...(farmland !== "unknown" ? { ownsFarmland: farmland === "yes" } : {})
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
      const response = await api("/schemes", schemesSchema, "POST", { profile: parsed.data, language });
      setSchemeReply(response.reply); setSchemes(response.schemes); setHasMatched(true); receive(response.reply);
    });
  }
  function onTranscript(result: TranscriptionResponse, target: "chat" | "form") {
    if (target === "chat") { setPrompt(result.text.slice(0, 4000)); setTab("Chat"); }
    else { setInstruction(result.text.slice(0, 4000)); setTab("Documents"); }
    const detected = result.language !== "und" && result.locale !== "und";
    const supported = languages.some(item => item.code === result.language);
    if (autoLanguage && detected && supported) setLanguage(result.language);
    setNotice(`Voice transcribed (${detected ? result.locale : "language uncertain; previous language kept"}). Review the text before submitting.${detected && !supported ? " This speech language is not in the translation language list; your previous output language was kept." : ""}${result.text.length > 4000 ? " The transcript was shortened to the 4,000-character input limit." : ""}`);
  }
  const languageChoices = languages.filter(item => `${item.name} ${item.nativeName} ${item.code}`.toLowerCase().includes(languageSearch.toLowerCase()));
  const controls = <View style={s.stack}>
    <Card>
      <Text style={s.eyebrow}>Your conversation</Text>
      <Text style={s.title}>{selectedLanguage?.nativeName || language}</Text>
      <Button subtle title={languageExpanded ? "Close language picker" : "Change language"} onPress={() => setLanguageExpanded(value => !value)} />
      {languageExpanded && <View style={s.stack}>
        <Input label="Find a language" value={languageSearch} onChangeText={setLanguageSearch} placeholder="Hindi, Arabic, Telugu…" />
        <ScrollView style={{ maxHeight: 230 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <View style={s.stack}>{languageChoices.map(item => <Button subtle key={item.code} title={`${item.nativeName} · ${item.name}`} selected={language === item.code}
            disabled={busy} onPress={() => { setLanguage(item.code); setLanguageExpanded(false); }} />)}
            {!languageChoices.length && <Text style={s.muted}>No supported languages match your search.</Text>}</View>
        </ScrollView>
      </View>}
      {demo && <Text style={s.caption}>Demo answers are English only. Azure mode unlocks supported multilingual services.</Text>}
      {!!languageError && <View><Text style={s.errorText}>{languageError}</Text><Button subtle title="Retry language list" onPress={() => setLanguageVersion(value => value + 1)} /></View>}
      <Toggle label="Follow the language I use" value={autoLanguage} onChange={setAutoLanguage} disabled={busy} />
      <Toggle label="Read new replies aloud" value={autoplay} onChange={setAutoplay} disabled={busy} />
      <Text style={s.caption}>Every assistant reply includes replay controls. Device voices depend on your installed languages.</Text>
    </Card>
    <Card>
      <VoiceInput enabled={health?.mode === "azure" && signedIn && consent} token={session?.accessToken}
        target={voiceTarget} onTarget={setVoiceTarget} onTranscript={onTranscript} onError={reportError}
        stopPlayback={voice.stop} onRecording={setRecording} disabled={!!pending} />
    </Card>
    <Card accent>
      <Text style={s.eyebrow}>Always in your hands</Text>
      <Text style={s.muted}>Understand first. Review carefully. Sahayak never submits an official application for you.</Text>
      <Text style={s.caption}>Scheme matches are guidance, not an eligibility decision.</Text>
    </Card>
  </View>;

  return <SafeAreaView style={s.root}>
    <StatusBar style="dark" />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, width < 600 && s.compactPage]}>
      <View style={s.header}>
        <View style={s.brand}>
          <View style={s.logo}><Text style={s.logoText}>स</Text></View>
          <View><Text accessibilityRole="header" style={s.brandTitle}>Sahayak</Text><Text style={s.caption}>A little help. A way forward.</Text></View>
        </View>
        <View style={s.row}>
          <Text style={[s.badge, demo && s.demoBadge]}>{health ? `${health.mode.toUpperCase()} MODE` : "CONNECTING"}</Text>
          <Text style={s.caption}>{demo ? "Local demonstration" : signedIn ? "Signed in securely" : "Your public-service companion"}</Text>
        </View>
      </View>
      <View style={s.hero}>
        <Text style={s.eyebrow}>LESS CONFUSION. MORE CONFIDENCE.</Text>
        <Text accessibilityRole="header" style={[s.heroTitle, width < 600 && s.heroCompact]}>The next step,{"\n"}in your own language.</Text>
        <Text style={s.heroText}>Find support that may fit your life. Make sense of a document. Prepare a draft you can review — one clear step at a time.</Text>
        <View style={s.row}><Text style={s.smallPill}>01  Discover support</Text><Text style={s.smallPill}>02  Understand documents</Text><Text style={s.smallPill}>03  Review your draft</Text></View>
      </View>
      {connecting && <View style={s.progress}><ActivityIndicator color={colors.indigo} /><Text style={s.body}>Connecting to Sahayak…</Text></View>}
      {!!connectionError && <View style={s.error} accessibilityRole="alert"><Text style={s.errorText}>{connectionError}</Text>
        <Text style={s.caption}>API: {API_URL}</Text><Button title="Retry connection" onPress={() => setConnectionVersion(value => value + 1)} /></View>}
      {health && <View style={s.notice}>
        <Text style={[s.noticeText, { fontWeight: "700" }]}>{demo ? "Honest demo · fictional information only" : "Azure services · your consent matters"}</Text>
        <Text style={s.noticeText}>{demo
          ? "This local demo uses deterministic examples — not AI, OCR, translation, or voice recognition. Read-aloud uses your device. Never upload real identity, financial, or sensitive documents."
          : "Questions, profile details, uploaded documents, and recordings are processed by configured Azure services. Only share information you have permission to use. Do not include unnecessary sensitive data."}</Text>
        {health.limitations.map((item, index) => <Text key={index} style={s.noticeText}>• {item}</Text>)}
        <Toggle label={demo ? "I will use fictional details and demonstration documents only." : "I consent to Azure processing when I explicitly send, record, or upload."}
          value={demo ? demoConsent : consent} onChange={demo ? setDemoConsent : setConsent} disabled={busy} />
      </View>}
      {health?.mode === "azure" && !signedIn && <Card>
        <Text style={s.title}>Connect your Microsoft account</Text>
        {authConfigured ? <SignIn onSession={onSession} onError={reportError} />
          : <Text style={s.muted}>Azure sign-in is not configured. Set the public Entra tenant, client ID, and API scope in the mobile environment, then restart Expo. No client secret belongs in this app.</Text>}
      </Card>}
      {!!sessionNotice && <Text accessibilityRole="alert" style={s.errorText}>{sessionNotice}</Text>}
      {!!error && <View style={s.error} accessibilityRole="alert">
        <Text style={s.errorText}>{error}</Text><View style={s.row}>
          {!!retryLabel && <Button title="Retry last action" disabled={busy || !allowed} onPress={() => { if (retry.current) execute(retryLabel, retry.current); }} />}
          <Button subtle title="Dismiss error" onPress={() => setError("")} />
        </View>
      </View>}
      {!!notice && <View style={s.progress}><Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text></View>}
      {!!pending && <View style={s.progress}><ActivityIndicator color={colors.indigo} /><Text accessibilityLiveRegion="polite" style={s.body}>{pending}…</Text></View>}
      <View style={s.tabs}>{(["Chat", "Schemes", "Documents", "Settings"] as const).map(item =>
        <Button key={item} title={item} subtle selected={tab === item} disabled={recording} onPress={() => setTab(item)} />)}</View>
      <View style={wide ? s.workspace : s.stack}>
        <View style={wide ? s.sidebar : { width: "100%", gap: 12 }}>
          {!wide && <Button subtle title={showControls ? "Hide language & voice controls" : `Language & voice · ${selectedLanguage?.name || language}`} disabled={recording}
            onPress={() => setShowControls(value => !value)} />}
          <View style={!wide && !showControls ? { display: "none" } : undefined}>{controls}</View>
        </View>
        <View style={s.main}>
          <View style={[s.stack, tab !== "Chat" && { display: "none" }]}>
            <Section title="A conversation, not a complicated process." eyebrow="YOUR ASSISTANT">
              <Text style={s.muted}>Ask a question, or start with one of these ideas.</Text>
            </Section>
            {!messages.length && <Card>
              <Text style={s.title}>Hello. What can I help you with?</Text>
              <Text style={s.body}>Tell me what you need, in the language that feels most natural. I can help you explore support and understand your next step.</Text>
              <View style={s.row}>{["What support might fit my family?", "Help me understand an application", "What should I check before applying?"].map(text =>
                <Button key={text} title={text} subtle disabled={busy} onPress={() => setPrompt(text)} />)}</View>
              <Text style={s.caption}>Suggestions only fill your input. Nothing is sent until you choose Send.</Text>
            </Card>}
            {messages.map(item => item.role === "user"
              ? <View key={item.id} style={s.userBubble}><Text style={s.eyebrow}>YOU</Text><Text selectable style={[s.body, /^(ar|ur|fa|he)/.test(item.language) && s.rtl]}>{item.text}</Text></View>
              : <Card key={item.reply.id}><Reply reply={item.reply} voice={voice} onError={reportError} disabled={recording} /></Card>)}
            <Card>
              {active && <View style={s.row}><Text style={s.smallPill}>Context: {active.name}</Text><Button subtle title="Remove chat context" disabled={busy} onPress={() => setActiveId(null)} /></View>}
              <Input label="Your message" multiline maxLength={4000} editable={!busy} value={prompt} onChangeText={setPrompt}
                placeholder="Tell me what you need help with…" style={/^(ar|ur|fa|he)/.test(language) ? s.rtl : undefined} />
              <View style={s.row}><Button title="Send message ↗" disabled={disabled || !prompt.trim()} onPress={send} />
                <Button subtle title="Open sample form" disabled={disabled} onPress={sample} />
                <Text style={s.caption}>{prompt.length}/4,000</Text></View>
              <Text style={s.caption}>AI can make mistakes. Check important details with official sources. Voice transcription is reviewed before sending.</Text>
            </Card>
          </View>

          <View style={[s.stack, tab !== "Schemes" && { display: "none" }]}>
            <Section title="Support that may fit your situation." eyebrow="SCHEME DISCOVERY">
              <Text style={s.muted}>Share only what you are comfortable with. Blank answers stay unknown — never assumed.</Text>
            </Section>
            <Card>
              <View style={s.row}>
                <Input label="Age (optional)" value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} editable={!busy} placeholder="e.g. 28" />
                <Input label="Annual household income, INR (optional)" value={income} onChangeText={setIncome} keyboardType="decimal-pad" maxLength={14} editable={!busy} placeholder="e.g. 120000" />
              </View>
              <Input label="State or union territory (optional)" value={state} onChangeText={setState} editable={!busy} maxLength={80} placeholder="e.g. Telangana" />
              <Text style={s.label}>Occupation (optional)</Text>
              <View style={s.row}>
                <Button title="Unspecified" subtle selected={!occupation} disabled={busy} onPress={() => setOccupation(undefined)} />
                {occupations.map(value => <Button key={value} title={value.replace("-", " ")} subtle selected={occupation === value} disabled={busy} onPress={() => setOccupation(value)} />)}
              </View>
              <Text style={s.label}>Do you own farmland?</Text>
              <View style={s.row}>
                {(["unknown", "yes", "no"] as const).map(value => <Button key={value} title={value === "unknown" ? "Unspecified" : value === "yes" ? "Yes" : "No"}
                  subtle selected={farmland === value} disabled={busy} onPress={() => setFarmland(value)} />)}
              </View>
              <Button title="Find potential matches ↗" disabled={disabled} onPress={matchSchemes} />
            </Card>
            {schemeReply && <Card><Reply reply={schemeReply} voice={voice} onError={reportError} disabled={recording} /></Card>}
            {!hasMatched && <Card accent><Text style={s.title}>A starting point, not a promise.</Text><Text style={s.muted}>Your potential matches will appear here. Requirements and availability can change; the official portal is the final source.</Text></Card>}
            {hasMatched && schemes.length === 0 && <Card><Text style={s.muted}>No potential matches were returned for this profile. Add more details or check an official public-service portal.</Text></Card>}
            {schemes.map(scheme => <Card key={scheme.id}>
              <Text style={s.smallPill}>{scheme.status === "potential-match" ? "Potential match · verify eligibility" : "More details needed"}</Text>
              <Text style={s.title}>{scheme.title}</Text><Text style={s.body}>{scheme.reason}</Text>
              {!!scheme.missingDetails.length && <Text style={s.muted}>Still needed: {scheme.missingDetails.join(", ")}</Text>}
              <ExternalLink title="Check official source" url={scheme.officialUrl} onError={reportError} />
            </Card>)}
          </View>

          <View style={[s.stack, tab !== "Documents" && { display: "none" }]}>
            <Section title="From confusing paperwork to a clear draft." eyebrow="DOCUMENT WORKSPACE">
              <Text style={s.muted}>Upload → understand → fill → review → export. You stay in control of every answer.</Text>
            </Section>
            <Card>
              <View style={s.row}><Button title="Upload a document ↑" disabled={disabled} onPress={() => upload()} /><Button subtle title="Try a fictional sample" disabled={disabled} onPress={sample} /></View>
              <Text style={s.caption}>PDF, JPEG, PNG, or plain text · up to 6 MB. Demo supports plain-text extraction only; PDF/image OCR requires Azure.</Text>
              {!!documents.length && <View style={s.stack}><Text style={s.label}>Documents in this session</Text>
                <View style={s.row}>{documents.map(item => <Button key={item.id} title={`${item.name}${item.id === evidenceId ? " · evidence" : ""}`} subtle selected={activeId === item.id} disabled={busy} onPress={() => chooseDocument(item.id)} />)}</View>
              </View>}
            </Card>
            {!active && <Card accent><Text style={s.title}>Start with something simple.</Text><Text style={s.muted}>Try the sample application with fictional information. Or select a document above to continue. Uploaded files are not official submissions.</Text></Card>}
            {active && <>
              <Card>
                <View style={s.row}><Text style={[s.title, { flex: 1 }]}>{active.name}</Text><Text style={[s.badge, active.mode === "demo" && s.demoBadge]}>{active.mode.toUpperCase()}</Text></View>
                {active.warnings.map((warning, index) => <Text key={index} style={s.noticeText}>{warning}</Text>)}
                <Text style={s.eyebrow}>Extracted text</Text>
                <Text selectable style={[s.body, /^(ar|ur|fa|he)/.test(language) && s.rtl]}>{active.text ? (expandedText ? active.text : active.text.slice(0, 3500)) : "No text was extracted. Try a clearer file, or a plain-text document in demo mode."}</Text>
                {active.text.length > 3500 && <Button subtle title={expandedText ? "Show less text" : "Show all extracted text"} onPress={() => setExpandedText(value => !value)} />}
                <View style={s.row}>
                  <Button title="Explain this document" disabled={disabled || !active.text} onPress={() => documentAction("explain")} />
                  <Button subtle title={`Translate to ${selectedLanguage?.name || language}`} disabled={disabled || !active.text} onPress={() => documentAction("translate")} />
                </View>
                <Text style={s.caption}>Translation applies to extracted text, not the original document layout. Select the output language in conversation settings.</Text>
              </Card>
              {docReply && <Card><Reply reply={docReply} voice={voice} onError={reportError} disabled={recording} /></Card>}
              <Card>
                <Section title="Prepare a structured draft" eyebrow="YOUR DETAILS, YOUR DECISION" />
                <Input label="Instructions for your draft" multiline editable={!busy} maxLength={4000} value={instruction} onChangeText={setInstruction} style={/^(ar|ur|fa|he)/.test(language) ? s.rtl : undefined}
                  placeholder={"Use fictional details. In demo, enter exact Label: value pairs:\nApplicant name: Asha Example\nAge: 28\nState: Telangana"} />
                <Text style={s.caption}>You can type, record a message to “draft”, or attach a separate evidence document. Never invent information you do not know.</Text>
                <View style={s.row}><Button subtle title="Upload supporting evidence" disabled={disabled} onPress={() => upload(true)} />
                  {evidence && <Button subtle title={`Remove evidence: ${evidence.name}`} disabled={busy} onPress={() => setEvidenceId(null)} />}</View>
                {documents.some(item => item.id !== active.id) && <View style={s.stack}><Text style={s.label}>Or select an existing evidence document (plain text in demo)</Text><View style={s.row}>
                  {documents.filter(item => item.id !== active.id).map(item => <Button subtle key={item.id} title={item.name} selected={evidenceId === item.id} disabled={busy}
                    onPress={() => setEvidenceId(item.id)} />)}
                </View></View>}
                <Button title="Fill draft from instructions" disabled={disabled || !instruction.trim()} onPress={fill} />
                <Text style={s.caption}>New or changed values must be explicitly reviewed. Evidence can be wrong or incomplete; it is never an eligibility decision.</Text>
              </Card>
              <Card>
                <Section title="Review every provided answer" eyebrow="FINAL CHECK" />
                {!active.fields.length && <Text style={s.muted}>No structured fields are available for this document. Try a form with clearly labeled fields or the sample form.</Text>}
                {active.fields.map(field => <View key={field.id} style={s.field}>
                  <Input label={field.label} value={field.value} editable={!busy} multiline maxLength={2000} style={/^(ar|ur|fa|he)/.test(language) ? s.rtl : undefined}
                    onChangeText={value => rememberDocument({ ...active, fields: active.fields.map(item => item.id === field.id ? { ...item, value, confirmed: false } : item) })} />
                  <Text style={s.caption}>Source: {field.source || "Not provided"}</Text>
                  <Toggle label={`I reviewed ${field.label}`} value={field.confirmed} disabled={busy || !field.value.trim()}
                    onChange={confirmed => rememberDocument({ ...active, fields: active.fields.map(item => item.id === field.id ? { ...item, confirmed } : item) })} />
                </View>)}
                <View style={s.row}>
                  <Button subtle title="Save reviewed fields" disabled={disabled || !active.fields.length}
                    onPress={() => execute("Saving reviewed fields", async () => { await saveFields(active); setNotice("Your field edits and confirmations were saved."); })} />
                  <Button title="Export reviewed answers ↓" disabled={disabled || !active.fields.some(field => field.value.trim()) || active.fields.some(field => field.value.trim() && !field.confirmed)}
                    onPress={() => execute("Exporting reviewed answers", async () => {
                      await saveFields(active);
                      const file = await api(`/documents/${active.id}/export`, exportSchema);
                      await exportAnswers(file);
                      setNotice("Reviewed answer sheet prepared. It is not a completed official application.");
                    })} />
                </View>
                <Text style={s.noticeText}>Export creates reviewed-answer.txt, a UTF-8 answer sheet — not a layout-preserving or completed government PDF. Confirm all nonempty answers first. The server checks again.</Text>
              </Card>
              <Card>
                <Text style={s.title}>Manage this document</Text>
                <Text style={s.muted}>Delete removes the document from the service and this session. Reload discards unsaved local field edits.</Text>
                <View style={s.row}>
                  <Button subtle title="Reload saved document" disabled={disabled} onPress={() => execute("Reloading document", async () => {
                    rememberDocument(await api(`/documents/${active.id}`, documentSchema)); setNotice("Loaded the saved version. Local unsaved changes were replaced.");
                  })} />
                  <Button danger title={deleteId === active.id ? "Confirm delete document" : "Delete document"} disabled={disabled} onPress={() => {
                    if (deleteId !== active.id) { setDeleteId(active.id); return; }
                    execute("Deleting document", async () => {
                      await api(`/documents/${active.id}`, deletedSchema, "DELETE");
                      setDocuments(current => current.filter(item => item.id !== active.id));
                      if (evidenceId === active.id) setEvidenceId(null);
                      setActiveId(null); setDocReply(null); setDeleteId(null); setNotice("Document deleted from the service and this session.");
                    });
                  }} />
                  {deleteId === active.id && <Button subtle title="Keep document" disabled={busy} onPress={() => setDeleteId(null)} />}
                </View>
              </Card>
            </>}
          </View>

          <View style={[s.stack, tab !== "Settings" && { display: "none" }]}>
            <Section title="Simple controls. Clear boundaries." eyebrow="SETTINGS & PRIVACY" />
            <Card>
              <Text style={s.title}>Connection</Text><Text selectable style={s.body}>{API_URL}</Text>
              <Text style={s.muted}>Mode: {health?.mode.toUpperCase() || "not connected"}. The mode is reported by the backend, not simulated by this interface.</Text>
              <Button subtle title="Refresh connection" disabled={busy || connecting} onPress={() => setConnectionVersion(value => value + 1)} />
              <Text style={s.caption}>For a physical phone, configure EXPO_PUBLIC_API_URL with your computer’s reachable LAN address. Android emulator localhost refers to the emulator; use 10.0.2.2 for its host. Use HTTPS for Azure and deployed web apps.</Text>
            </Card>
            <Card>
              <Text style={s.title}>Your session</Text>
              <Text style={s.body}>{session ? `Access token expires at ${new Date(session.expiresAt).toLocaleTimeString()}.` : demo ? "No authentication is used in local demo mode." : "Not signed in."}</Text>
              <Text style={s.muted}>Tokens, conversation history, and document references are held in memory only. A reload clears local state, but does not delete documents stored by the service. Use Delete document for that.</Text>
              {session && <Button danger title="Sign out of Sahayak" disabled={busy} onPress={() => {
                setSession(null); setConsent(false); clearPrivateState();
                retry.current = null; setRetryLabel(""); setError(""); setNotice("Signed out of this app. Your Microsoft browser session may still be active.");
                void voice.stop().catch(cause => reportError(errorMessage(cause)));
              }} />}
              <Button subtle title="Clear local conversation" disabled={busy} onPress={() => {
                setMessages([]); setPrompt(""); setNotice("Conversation cleared on this device.");
                void voice.stop().catch(cause => reportError(errorMessage(cause)));
              }} />
            </Card>
            <Card>
              <Text style={s.title}>Language & audio</Text>
              <Text style={s.muted}>Automatic language follows the language detected in your new text or voice message. Low-confidence detection can preserve your previous language. The picker lists languages supported by this service, not every language in the world.</Text>
              <Text style={s.muted}>Automatic read-aloud starts off. Browser autoplay policies may require pressing Replay. Device read-aloud is an explicit fallback using an installed voice; it is not Azure synthesis.</Text>
              <Text style={s.muted}>Microphone access needs HTTPS or localhost on web, permission on your device, and Azure mode. Recordings are limited to 60 seconds and 6 MB.</Text>
            </Card>
            <Card>
              <Text style={s.title}>Entra configuration</Text>
              <Text style={s.muted}>Use an Entra public client with authorization code + PKCE. Never add a client secret or service key to the app. Register the exact redirect shown below.</Text>
              <Text selectable style={s.body}>{redirectUri}</Text>
              <Text style={s.caption}>Native redirect: sahayak://auth in an installed development/preview build. Expo Go is not a reliable OAuth redirect target. For web, register the exact web origin as a SPA redirect (for local development: http://localhost:8081). Web code exchange requires Entra SPA CORS support.</Text>
            </Card>
          </View>
        </View>
      </View>
      <Text style={s.footer}>SAHAYAK · Built for understanding, designed for dignity.{"\n"}Not an official government portal. Verify requirements before applying.</Text>
    </ScrollView>
  </SafeAreaView>;
}
