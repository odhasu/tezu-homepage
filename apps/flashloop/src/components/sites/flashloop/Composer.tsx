"use client";

import { localPath } from "@/lib/local-path";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import { studioLink } from "@/lib/links";
import { saveCreationDraft } from "@/lib/creation-draft";

type Kind = "Video" | "Image";
type Attachment = { name: string; url: string; type: string };
const models = {
  Video: [
    "Kling 4.0",
    "Kling 3.0",
    "Sora 2",
    "Seedance 2.5",
    "Veo 3.1",
    "Wan 3.0",
    "MiniMax Hailuo 3",
  ],
  Image: [
    "Nano Banana 2.1",
    "Nano Banana Pro",
    "GPT Image 2",
    "Flux 2",
    "Seedream 5.0",
  ],
};

export function Composer() {
  const [kind, setKind] = useState<Kind>("Video");
  const [model, setModel] = useState("Kling 4.0");
  const [workflow, setWorkflow] = useState("Reference to Video");
  const [prompt, setPrompt] = useState("");
  const [panel, setPanel] = useState<string | null>(null);
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState("5s");
  const [quality, setQuality] = useState("1080p");
  const [count, setCount] = useState("1");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const id = useId();

  useEffect(() => {
    const currentUrls = urls.current;
    return () => {
      currentUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [panel]);

  function changeKind(next: Kind) {
    setKind(next);
    setModel(models[next][0]);
    setWorkflow(next === "Video" ? "Reference to Video" : "Text to Image");
    setPanel(null);
  }

  function submit() {
    if (!prompt.trim()) return;
    const next = kind === "Video" ? "video" : "image";
    // File previews are local; private upload activation is a separate server gate.
    if (attachments.length) {
      setError("Reference files stay on this page. Remove them to continue with your text draft; uploads are not available yet.");
      return;
    }
    if (!saveCreationDraft({ kind: next, prompt: prompt.trim(), model, ratio, quality, count, duration })) {
      setError("Your browser could not keep this draft. Copy your prompt before opening the workspace.");
      return;
    }
    window.location.assign(studioLink(next));
  }

  return (
    <div
      className="composer"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPanel(null);
          root.current
            ?.querySelector<HTMLButtonElement>("[aria-expanded=true]")
            ?.focus();
        }
      }}
    >
      <div className="composer-kind" role="tablist" aria-label="Creation type">
        {(["Video", "Image"] as const).map((item) => (
          <button
            key={item}
            role="tab"
            id={`${id}-${item}`}
            aria-selected={kind === item}
            aria-controls={`${id}-panel`}
            tabIndex={kind === item ? 0 : -1}
            onClick={() => changeKind(item)}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const next = kind === "Video" ? "Image" : "Video";
                changeKind(next);
                document.getElementById(`${id}-${next}`)?.focus();
              }
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div
        className="composer-card"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${kind}`}
      >
        <div className="composer-promptArea">
          <input
            ref={input}
            type="file"
            multiple
            accept={kind === "Video" ? "image/*,video/*" : "image/*"}
            className="sr-only"
            aria-label="Upload reference files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              const valid = files.filter(
                (file) =>
                  (file.type.startsWith("image/") ||
                    (kind === "Video" && file.type.startsWith("video/"))) &&
                  file.size <= 30 * 1024 * 1024,
              );
              setError(
                valid.length !== files.length
                  ? "Choose image or video files smaller than 30 MB."
                  : "",
              );
              const next = valid
                .slice(0, Math.max(0, 4 - attachments.length))
                .map((file) => {
                  const url = URL.createObjectURL(file);
                  urls.current.add(url);
                  return { name: file.name, type: file.type, url };
                });
              setAttachments((items) => [...items, ...next]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="composer-upload"
            aria-label="Add reference images or videos"
            onClick={() => input.current?.click()}
            disabled={attachments.length >= 4}
          >
            <Icon name="plus" width="24" height="24" />
          </button>
          {attachments.length > 0 && (
            <div className="composer-attachments">
              {attachments.map((file) => (
                <div key={file.url}>
                  {file.type.startsWith("image/") ? (
                    <img src={file.url} alt={file.name} />
                  ) : (
                    <video
                      src={file.url}
                      muted
                      playsInline
                      aria-label={file.name}
                    />
                  )}
                  <button
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(file.url);
                      urls.current.delete(file.url);
                      setAttachments((items) =>
                        items.filter((item) => item.url !== file.url),
                      );
                    }}
                  >
                    <Icon name="close" width="12" height="12" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-promptWrap">
            <textarea
              aria-label={`Describe your ${kind.toLowerCase()}`}
              maxLength={6000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {!prompt && (
              <div className="composer-placeholder">
                {kind === "Video" ? (
                  <>
                    Upload images or videos and <span>@</span> them as
                    references to guide your video.
                  </>
                ) : (
                  <>
                    Describe the image you want to create, or upload a
                    reference.
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="composer-toolbar">
          <button
            className="composer-workflow"
            aria-expanded={panel === "workflow"}
            aria-controls={`${id}-workflow`}
            onClick={() => setPanel(panel === "workflow" ? null : "workflow")}
          >
            {workflow}
            <Icon
              name="chevron"
              className="rotate-down"
              width="12"
              height="12"
            />
          </button>
          <button
            className="composer-model"
            aria-label="Choose generation model"
            aria-expanded={panel === "model"}
            aria-controls={`${id}-model`}
            onClick={() => setPanel(panel === "model" ? null : "model")}
          >
            <img
              src={localPath(`/sites/flashloop/graphics/model-${kind === "Video" ? "0" : "9"}.svg`)}
              alt=""
              width="19"
              height="19"
            />
            {model}
          </button>
          <span className="composer-divider" />
          <button
            className="composer-settings"
            aria-label={`Generation settings: ${ratio} / ${kind === "Video" ? duration + " / " : ""}${quality} / ${count}`}
            aria-expanded={panel === "settings"}
            aria-controls={`${id}-settings`}
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
          >
            <span>
              {ratio} / {kind === "Video" && `${duration} / `}
              {quality} / {count}
            </span>
            <Icon name="settings" />
          </button>
          <div className="composer-submitGroup">
            <span
              aria-label={`Estimated cost: ${kind === "Video" ? 60 * Number(count) : 8 * Number(count)} credits`}
            >
              <Icon name="coins" />
              {kind === "Video" ? 60 * Number(count) : 8 * Number(count)}{" "}
              <small>est.</small>
            </span>
            <button
              className="composer-submit"
              aria-label={`Create ${kind.toLowerCase()}`}
              disabled={!prompt.trim()}
              onClick={submit}
            >
              <Icon name="up" width="24" height="24" />
            </button>
          </div>
        </div>
        {panel && (
          <div className="composer-popover" id={`${id}-${panel}`}>
            <div className="composer-popoverHeading">
              <strong>
                {panel === "model"
                  ? "Choose a model"
                  : panel === "workflow"
                    ? "Creation workflow"
                    : "Generation settings"}
              </strong>
              <button aria-label="Close options" onClick={() => setPanel(null)}>
                <Icon name="close" />
              </button>
            </div>
            {panel === "model" &&
              models[kind].map((item) => (
                <button
                  key={item}
                  className="composer-option"
                  aria-pressed={model === item}
                  onClick={() => {
                    setModel(item);
                    setPanel(null);
                  }}
                >
                  {item}
                  {model === item && <span>✓</span>}
                </button>
              ))}
            {panel === "workflow" &&
              (kind === "Video"
                ? ["Reference to Video", "Text to Video", "Image to Video"]
                : ["Text to Image", "Image to Image"]
              ).map((item) => (
                <button
                  key={item}
                  className="composer-option"
                  aria-pressed={workflow === item}
                  onClick={() => {
                    setWorkflow(item);
                    setPanel(null);
                  }}
                >
                  {item}
                </button>
              ))}
            {panel === "settings" && (
              <div className="composer-fields">
                <label>
                  Aspect ratio
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                  >
                    {["16:9", "9:16", "1:1", "4:3"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {kind === "Video" && (
                  <label>
                    Duration
                    <select
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    >
                      {["5s", "10s", "15s"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Resolution
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                  >
                    {["720p", "1080p"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Outputs
                  <select
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  >
                    {["1", "2", "4"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}
        <p className="sr-only">
          Press Enter to continue, or Shift and Enter for a new line. Credit
          amounts are preview estimates. Reference files stay on this page.
        </p>
        {error && (
          <p role="alert" className="composer-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
