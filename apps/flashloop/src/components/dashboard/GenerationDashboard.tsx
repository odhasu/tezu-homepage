"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { flushSync } from "react-dom";
import Image from "next/image";
import { localPath } from "@/lib/local-path";
import { authLink } from "@/lib/links";
import { createPrivateRequests } from "@/lib/private-requests";
import { clearCreationDraft, consumeCreationDraft } from "@/lib/creation-draft";
import { getAuthSession, postAuth } from "@/components/auth/auth-api";
import { Icon } from "@/components/sites/flashloop/Icon";
import styles from "./dashboard.module.css";

type CreationKind = "image" | "video";

type GenerationDashboardProps = {
  kind?: CreationKind;
  runtime?: boolean;
};

type Project = {
  id: string;
  name: string;
  createdAt?: string;
};

type Job = {
  id: string;
  label: string;
  status: string;
  createdAt?: string;
};

type LocalAttachment = {
  id: string;
  name: string;
  type: string;
  url: string;
};

type RuntimeState = "idle" | "loading" | "ready" | "error";
type SessionState = "static" | "checking" | "authenticated" | "signed-out" | "error";

const modelOptions: Record<CreationKind, string[]> = {
  image: ["Nano Banana 2.1", "Nano Banana Pro", "GPT Image 2", "Flux 2", "Seedream 5.0"],
  video: ["Kling 4.0", "Kling 3.0", "Sora 2", "Seedance 2.5", "Veo 3.1", "Wan 3.0", "MiniMax Hailuo 3"],
};

const workflowOptions: Record<CreationKind, string[]> = {
  image: ["Text to Image", "Image Remix", "Product scene"],
  video: ["Reference to Video", "Text to Video", "Image to Video"],
};

const examplePrompts: Record<CreationKind, string[]> = {
  image: [
    "A quiet midnight bookstore with a warm pool of light",
    "Editorial product photograph of a silver camera on blue glass",
    "A hand-drawn travel poster for a city on the moon",
  ],
  video: [
    "A slow dolly through a neon market after rain",
    "A paper airplane folds itself and crosses a sunlit room",
    "A tiny astronaut discovers a garden inside a teacup",
  ],
};

const ratios = ["16:9", "9:16", "1:1", "4:3"];
const qualityOptions = ["720p", "1080p"];

function studioHref(kind: CreationKind, runtime: boolean): string {
  return runtime ? localPath(`/account?kind=${kind}`) : localPath(`/create/${kind}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataValue(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function parseProject(value: unknown): Project | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    createdAt: typeof value.created_at === "string" ? value.created_at : undefined,
  };
}

function parseJob(value: unknown): Job | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return null;
  return {
    id: value.id,
    label: typeof value.label === "string" && value.label.trim() ? value.label : "Untitled generation",
    status: value.status,
    createdAt: typeof value.created_at === "string" ? value.created_at : undefined,
  };
}

async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { Accept: "application/json", "X-Requested-With": "flashloop", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error("Request unavailable");
  return response.json() as Promise<unknown>;
}

function readableDate(value?: string): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function safeStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  return normalized || "unknown";
}

export function GenerationDashboard({ kind = "image", runtime = false }: GenerationDashboardProps) {
  const activeKind = kind;
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(modelOptions[kind][0]);
  const [workflow, setWorkflow] = useState(workflowOptions[kind][0]);
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState("1080p");
  const [duration, setDuration] = useState("5s");
  const [count, setCount] = useState("1");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projectState, setProjectState] = useState<RuntimeState>(runtime ? "loading" : "idle");
  const [jobState, setJobState] = useState<RuntimeState>("idle");
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [projectMessage, setProjectMessage] = useState("");
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const [sessionState, setSessionState] = useState<SessionState>(runtime ? "checking" : "static");
  const [sessionCredits, setSessionCredits] = useState<number | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const attachmentUrls = useRef(new Set<string>());
  const sessionCheck = useRef<AbortController | null>(null);
  const sessionScope = useRef<string | null>(null);
  const sessionEpoch = useRef(0);
  const projectMutation = useRef<AbortController | null>(null);
  const signoutInProgress = useRef(false);
  const [privateReads] = useState(createPrivateRequests);

  const qualities = qualityOptions;
  const activeModelOptions = modelOptions[activeKind];
  const activeWorkflowOptions = workflowOptions[activeKind];
  const activeExamples = examplePrompts[activeKind];
  const kindLabel = activeKind === "image" ? "Image" : "Video";

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const draft = consumeCreationDraft(kind);
      if (!draft) return;
      setPrompt(draft.prompt);
      if (modelOptions[kind].includes(draft.model)) setModel(draft.model);
      if (ratios.includes(draft.ratio)) setRatio(draft.ratio);
      if (qualityOptions.includes(draft.quality)) setQuality(draft.quality);
      if (["1", "2", "4"].includes(draft.count)) setCount(draft.count);
      if (["5s", "10s", "15s"].includes(draft.duration)) setDuration(draft.duration);
    });
    return () => { active = false; };
  }, [kind]);

  useEffect(() => {
    const urls = attachmentUrls.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  const clearPrivateState = useCallback(() => {
    privateReads.reset();
    clearCreationDraft();
    setProjects([]);
    setProjectId("");
    setJobs([]);
    setProjectState("idle");
    setJobState("idle");
    setPrompt("");
    setProjectName("");
    setRuntimeMessage("");
    setProjectMessage("");
    setAttachmentMessage("");
    setPreviewLoading(false);
    setCreatingProject(false);
    setSessionCredits(undefined);
    setAttachments((current) => {
      current.forEach((item) => {
        URL.revokeObjectURL(item.url);
        attachmentUrls.current.delete(item.url);
      });
      return [];
    });
  }, [privateReads]);

  const validateSession = useCallback(async () => {
    if (!runtime || signoutInProgress.current) return;
    privateReads.reset();
    sessionEpoch.current++;
    projectMutation.current?.abort();
    sessionCheck.current?.abort();
    const controller = new AbortController();
    sessionCheck.current = controller;
    setSessionState("checking");
    setSessionCredits(undefined);
    try {
      const session = await getAuthSession(controller.signal);
      if (controller.signal.aborted) return;
      if (!session.authenticated || !session.verified || session.emailConfirmed !== true || !session.sessionScope) {
        clearPrivateState();
        sessionScope.current = null;
        setSessionState("signed-out");
        return;
      }
      if (sessionScope.current && sessionScope.current !== session.sessionScope) clearPrivateState();
      sessionScope.current = session.sessionScope;
      privateReads.bind(session.sessionScope);
      setSessionCredits(session.credits);
      setSessionState("authenticated");
    } catch {
      if (controller.signal.aborted) return;
      clearPrivateState();
      setSessionState("error");
    }
  }, [clearPrivateState, privateReads, runtime]);

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    queueMicrotask(() => { if (active) void validateSession(); });
    const revalidate = () => { void validateSession(); };
    const clearOnPageHide = () => {
      sessionEpoch.current++;
      sessionCheck.current?.abort();
      projectMutation.current?.abort();
      privateReads.reset();
      sessionScope.current = null;
      flushSync(() => { clearPrivateState(); setSessionState("checking"); });
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    window.addEventListener("pagehide", clearOnPageHide);
    return () => {
      active = false;
      sessionCheck.current?.abort();
      projectMutation.current?.abort();
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      window.removeEventListener("pagehide", clearOnPageHide);
    };
  }, [clearPrivateState, privateReads, runtime, validateSession]);

  useEffect(() => {
    if (!runtime || sessionState !== "authenticated") return;
    const request = privateReads.begin("projects");
    if (!request) return;
    queueMicrotask(() => {
      if (request.current()) { setProjectState("loading"); setRuntimeMessage(""); }
    });
    void requestJson(localPath("/api/projects"), { signal: request.signal })
      .then((payload) => {
        const value = dataValue(payload);
        const list = Array.isArray(value) ? value.map(parseProject).filter((item): item is Project => item !== null) : [];
        if (!request.current()) return;
        setProjects(list);
        setProjectId((current) => list.some((item) => item.id === current) ? current : list[0]?.id ?? "");
        setProjectState("ready");
      })
      .catch(() => {
        if (!request.current()) return;
        setProjects([]);
        setProjectId("");
        setProjectState("error");
        setRuntimeMessage("Projects are unavailable right now. Try again in a moment.");
      });
    return request.cancel;
  }, [privateReads, runtime, sessionState]);

  useEffect(() => {
    if (!runtime || sessionState !== "authenticated" || !projectId) return;
    const request = privateReads.begin("jobs");
    if (!request) return;
    queueMicrotask(() => { if (request.current()) { setJobs([]); setJobState("loading"); } });
    void requestJson(localPath(`/api/projects/${encodeURIComponent(projectId)}/jobs`), { signal: request.signal })
      .then((payload) => {
        const value = dataValue(payload);
        const list = Array.isArray(value) ? value.map(parseJob).filter((item): item is Job => item !== null) : [];
        if (!request.current()) return;
        setJobs(list);
        setJobState("ready");
      })
      .catch(() => {
        if (!request.current()) return;
        setJobs([]);
        setJobState("error");
      });
    return request.cancel;
  }, [privateReads, projectId, runtime, sessionState]);

  const projectLabel = useMemo(() => {
    if (!runtime) return "Preview workspace";
    return projects.find((project) => project.id === projectId)?.name ?? "Choose a workspace";
  }, [projectId, projects, runtime]);

  function addAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    const allowed = files.filter((file) => {
      const media = activeKind === "video" ? file.type.startsWith("image/") || file.type.startsWith("video/") : file.type.startsWith("image/");
      return media && file.size <= 30 * 1024 * 1024;
    });
    setAttachmentMessage(allowed.length !== files.length ? "Use supported media files smaller than 30 MB." : "");
    const next = allowed.slice(0, Math.max(0, 4 - attachments.length)).map((file) => {
      const url = URL.createObjectURL(file);
      attachmentUrls.current.add(url);
      return { id: url, name: file.name, type: file.type, url };
    });
    setAttachments((current) => [...current, ...next]);
    event.currentTarget.value = "";
  }

  function removeAttachment(id: string) {
    const removed = attachments.find((item) => item.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.url);
      attachmentUrls.current.delete(removed.url);
    }
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function startPreview() {
    if (!prompt.trim() || previewLoading || (runtime && sessionState !== "authenticated")) return;
    setPreviewLoading(true);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!runtime || sessionState !== "authenticated" || !name || creatingProject || !sessionScope.current) return;
    const epoch = sessionEpoch.current;
    const scope = sessionScope.current;
    const controller = new AbortController();
    projectMutation.current = controller;
    setCreatingProject(true);
    setProjectMessage("");
    try {
      const payload = await requestJson(localPath("/api/projects"), { method: "POST", body: JSON.stringify({ name }), signal: controller.signal });
      if (controller.signal.aborted || epoch !== sessionEpoch.current || scope !== sessionScope.current) return;
      const project = parseProject(dataValue(payload));
      if (!project) throw new Error("Invalid project");
      setProjects((current) => [project, ...current]);
      privateReads.cancel("jobs");
      setProjectId(project.id);
      setProjectName("");
    } catch {
      if (!controller.signal.aborted && epoch === sessionEpoch.current) setProjectMessage("Workspace could not be created. Try again.");
    } finally {
      if (projectMutation.current === controller) { projectMutation.current = null; setCreatingProject(false); }
    }
  }

  async function signOut() {
    if (signingOut) return;
    signoutInProgress.current = true;
    sessionEpoch.current++;
    sessionCheck.current?.abort();
    projectMutation.current?.abort();
    setSigningOut(true);
    clearPrivateState();
    setSessionState("checking");
    try {
      await postAuth("signout", {});
      window.location.assign(localPath("/auth"));
    } catch {
      setSessionState("error");
      setRuntimeMessage("Sign out could not finish. Check your connection and try again.");
    } finally {
      signoutInProgress.current = false;
      setSigningOut(false);
    }
  }

  if (runtime && sessionState !== "authenticated") {
    return (
      <main className={styles.sessionOnly} id="main-content">
        <a className={styles.sessionBrand} href={localPath("/blue/")} aria-label="Flashloop home">Flashloop<span>.</span></a>
        <section className={styles.sessionPanel} aria-live="polite">
          {sessionState === "checking" && <><span className={styles.sessionSpinner} aria-hidden="true" /><strong>Checking your session…</strong></>}
          {sessionState === "signed-out" && <><strong>Sign in to open your studio.</strong><a href={authLink()}>Continue to sign in <Icon name="diagonal" width="14" height="14" /></a></>}
          {sessionState === "error" && <><strong>{runtimeMessage || "Your session could not be checked."}</strong><button type="button" onClick={() => void validateSession()}>Check session again</button><button type="button" onClick={() => void signOut()} disabled={signingOut}>Sign out</button></>}
        </section>
      </main>
    );
  }

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar} aria-label="Flashloop studio navigation">
        <a className={styles.brand} href={localPath("/blue/")} aria-label="Flashloop home">Flashloop<span>.</span></a>
        <div className={styles.workspacePill}>
          <span className={styles.workspaceDot} aria-hidden="true" />
          <span>{projectLabel}</span>
        </div>
        <nav className={styles.nav} aria-label="Studio">
          <p className={styles.navLabel}>Create</p>
          <a className={`${styles.navItem} ${activeKind === "image" ? styles.navItemActive : ""}`} href={studioHref("image", runtime)} aria-current={activeKind === "image" ? "page" : undefined}>
            <span className={styles.navIcon}><Icon name="plus" /></span>
            Image
          </a>
          <a className={`${styles.navItem} ${activeKind === "video" ? styles.navItemActive : ""}`} href={studioHref("video", runtime)} aria-current={activeKind === "video" ? "page" : undefined}>
            <span className={styles.navIcon}><Icon name="arrow" /></span>
            Video
          </a>
          <p className={styles.navLabel}>Workspace</p>
          <a className={styles.navItem} href="#generation-history">
            <span className={styles.navIcon}><Icon name="chevron" /></span>
            Library
          </a>
          <a className={styles.navItem} href={runtime ? localPath("/account/billing/") : localPath("/pricing/")}>
            <span className={styles.navIcon}><Icon name="coins" /></span>
            Pricing
          </a>
        </nav>
        <div className={styles.sidebarBottom}>
          {runtime ? (
            <>
              <a className={styles.accountLink} href={localPath("/account/billing/")}>
                <span>Credits</span>
                <strong>{typeof sessionCredits === "number" ? sessionCredits.toLocaleString() : "—"}</strong>
              </a>
              <button className={styles.signOutButton} type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
            </>
          ) : (
            <div className={styles.previewNote}>
              <span className={styles.previewEyebrow}>Website preview</span>
              <p>Explore the tools. Account features become available after service setup.</p>
              <a href={authLink()}>Open account <Icon name="diagonal" width="14" height="14" /></a>
            </div>
          )}
        </div>
      </aside>

      <main className={styles.main} id="main-content">
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Flashloop studio <span>/</span> {kindLabel}</p>
            <h1>{activeKind === "image" ? "Create your next frame." : "Make something that moves."}</h1>
          </div>
          <div className={styles.topbarActions}>
            {!runtime && <span className={styles.previewBadge}>Website preview</span>}
            {runtime && <a className={styles.topbarLink} href={localPath("/blue/")}>Home</a>}
          </div>
        </header>

        <nav className={styles.kindTabs} aria-label="Generation type">
          {(["image", "video"] as const).map((item) => (
            <a
              className={`${styles.kindTab} ${activeKind === item ? styles.kindTabActive : ""}`}
              href={studioHref(item, runtime)}
              aria-current={activeKind === item ? "page" : undefined}
              key={item}
            >
              {item === "image" ? "Image" : "Video"}
            </a>
          ))}
        </nav>

        <div className={styles.contentGrid}>
          <section className={styles.editorCard} aria-labelledby="studio-heading">
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardKicker}>{kindLabel} generation</p>
                <h2 id="studio-heading">Describe your next {activeKind === "image" ? "frame" : "scene"}.</h2>
              </div>
              <span className={styles.statusDot}><i /> Provider setup</span>
            </div>

            <div className={styles.promptShell}>
              <label htmlFor="generation-prompt">Prompt</label>
              <textarea
                id="generation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value.slice(0, 6000))}
                placeholder={activeKind === "image" ? "Describe an image, mood, or visual direction…" : "Describe the action, camera, and atmosphere…"}
                maxLength={6000}
                rows={6}
              />
              <div className={styles.promptFooter}>
                <span>{prompt.length.toLocaleString()} / 6,000</span>
                <label className={styles.uploadButton}>
                  <input type="file" accept={activeKind === "video" ? "image/*,video/*" : "image/*"} multiple onChange={addAttachments} />
                  <Icon name="plus" width="16" height="16" /> Add reference
                </label>
              </div>
            </div>

            <div className={styles.examples} aria-label="Prompt examples">
              <span>Try an example</span>
              {activeExamples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}
            </div>

            {attachmentMessage && <p role="alert" className={styles.inlineError}>{attachmentMessage}</p>}
            {attachments.length > 0 && (
              <div className={styles.attachments} aria-label="Local reference previews">
                {attachments.map((attachment) => (
                  <div className={styles.attachment} key={attachment.id}>
                    {attachment.type.startsWith("video/") ? <video src={attachment.url} muted playsInline /> : <Image src={attachment.url} alt="" width={70} height={58} unoptimized />}
                    <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}><Icon name="close" width="14" height="14" /></button>
                  </div>
                ))}
                <p>References stay in this browser preview and are not uploaded.</p>
              </div>
            )}

            <div className={styles.controls}>
              <label>Model<select value={model} onChange={(event) => setModel(event.currentTarget.value)}>{activeModelOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Workflow<select value={workflow} onChange={(event) => setWorkflow(event.currentTarget.value)}>{activeWorkflowOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Aspect ratio<select value={ratio} onChange={(event) => setRatio(event.currentTarget.value)}>{ratios.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>{activeKind === "image" ? "Quality" : "Resolution"}<select value={quality} onChange={(event) => setQuality(event.currentTarget.value)}>{qualities.map((option) => <option key={option}>{option}</option>)}</select></label>
              {activeKind === "video" && <label>Duration<select value={duration} onChange={(event) => setDuration(event.currentTarget.value)}>{["5s", "10s", "15s", "30s"].map((option) => <option key={option}>{option}</option>)}</select></label>}
              <label>Outputs<select value={count} onChange={(event) => setCount(event.currentTarget.value)}>{["1", "2", "4"].map((option) => <option key={option}>{option}</option>)}</select></label>
            </div>

            <button type="button" className={styles.generateButton} disabled={!prompt.trim() || previewLoading || (runtime && sessionState !== "authenticated")} onClick={startPreview} aria-describedby="generation-note">
              <span>{previewLoading ? "Preview loading…" : `Generate ${kindLabel.toLowerCase()}`}</span>
              {previewLoading ? <span className={styles.loadingDots} aria-hidden="true"><i /><i /><i /></span> : <Icon name="arrow" width="20" height="20" />}
            </button>
            <p className={styles.generationNote} id="generation-note">
              {previewLoading ? "Local preview only. No server job, media output, or credit deduction is created." : runtime ? "Provider setup is still required. No generation request was sent." : "Generation is unavailable in this preview. No request is sent."}
            </p>
            {previewLoading && <div className={styles.previewLoading} role="status"><span className={styles.previewOrb} aria-hidden="true" /><div><strong>Waiting for provider setup</strong><p>This loading state stays local until you cancel it.</p></div><button type="button" onClick={() => setPreviewLoading(false)}>Cancel</button></div>}
          </section>

          <aside className={styles.rightRail}>
            {runtime && (
              <section className={styles.workspaceCard} aria-labelledby="workspace-heading">
                <div className={styles.cardHeaderCompact}><div><p className={styles.cardKicker}>Workspace</p><h2 id="workspace-heading">Your projects</h2></div><Icon name="settings" /></div>
                <label className={styles.projectSelect}>Active project<select value={projectId} onChange={(event) => { privateReads.cancel("jobs"); setJobs([]); setJobState("idle"); setProjectId(event.currentTarget.value); }} disabled={projectState === "loading" || projects.length === 0}><option value="">Choose a project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <form className={styles.projectForm} onSubmit={createProject}><input value={projectName} onChange={(event) => setProjectName(event.currentTarget.value.slice(0, 160))} placeholder="New project name" maxLength={160} aria-label="New project name" /><button type="submit" disabled={!projectName.trim() || creatingProject}>{creatingProject ? "Adding…" : "Add"}</button></form>
                {projectMessage && <p className={styles.inlineError} role="alert">{projectMessage}</p>}
                {runtimeMessage && <p className={styles.inlineError} role="alert">{runtimeMessage}</p>}
              </section>
            )}

            <section className={styles.historyCard} id="generation-history" aria-labelledby="history-heading">
              <div className={styles.cardHeaderCompact}><div><p className={styles.cardKicker}>Library</p><h2 id="history-heading">Recent generations</h2></div><Icon name="chevron" /></div>
              {!runtime && <div className={styles.emptyState}><div className={styles.emptyIcon}><Icon name="arrow" /></div><p>Your history appears after you sign in.</p><a href={authLink()}>About account access <Icon name="diagonal" width="14" height="14" /></a></div>}
              {runtime && jobState === "loading" && <p className={styles.loadingState}>Loading project history…</p>}
              {runtime && jobState === "error" && <p className={styles.loadingState}>History is unavailable right now.</p>}
              {runtime && jobState === "ready" && jobs.length === 0 && <div className={styles.emptyState}><div className={styles.emptyIcon}><Icon name="arrow" /></div><p>No generations in this project yet.</p><span>When a provider is ready, your jobs will appear here.</span></div>}
              {runtime && jobs.length > 0 && <ul className={styles.jobList}>{jobs.map((job) => <li key={job.id}><span className={styles.jobIcon}><Icon name={activeKind === "image" ? "plus" : "arrow"} /></span><div><strong>{job.label}</strong><small>{readableDate(job.createdAt)}</small></div><span className={`${styles.jobStatus} ${styles[`jobStatus_${safeStatus(job.status)}`] ?? ""}`}>{safeStatus(job.status)}</span></li>)}</ul>}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
