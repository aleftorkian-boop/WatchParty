import { FormEvent, useState } from "react";
import { resolveUrl } from "../lib/resolveUrl";
import type { ResolvedKind } from "../lib/types";

interface ControlsProps {
  isHost: boolean;
  canControl: boolean;
  allowAllControls: boolean;
  proxyEnabled: boolean;
  currentTime: number;
  playbackRate: number;
  isPlaying: boolean;
  onLoad: (url: string, useProxy: boolean, kind?: ResolvedKind, videoId?: string) => void;
  onTogglePlay: () => void;
  onSeek: (toTime: number) => void;
  onRate: (rate: number) => void;
  onToggleAllowAll: (value: boolean) => void;
}

export default function Controls({
  isHost,
  canControl,
  allowAllControls,
  proxyEnabled,
  currentTime,
  playbackRate,
  isPlaying,
  onLoad,
  onTogglePlay,
  onSeek,
  onRate,
  onToggleAllowAll,
}: ControlsProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [useProxy, setUseProxy] = useState(false);
  const [proxyTouched, setProxyTouched] = useState(false);
  const [seekInput, setSeekInput] = useState("0");
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoadError(null);

    const result = await resolveUrl(videoUrl);
    if (!result.ok || !result.resolvedUrl) {
      setLoadError(result.error || "Could not resolve this URL");
      return;
    }

    let useProxyForLoad = useProxy;
    if (proxyEnabled && result.needsProxy && !proxyTouched && !useProxy) {
      useProxyForLoad = true;
      setUseProxy(true);
    }

    onLoad(result.resolvedUrl, useProxyForLoad, result.kind, result.videoId);
  }

  return (
    <section className="panel controls-panel">
      <form onSubmit={handleLoad} className="load-row">
        <input
          type="url"
          value={videoUrl}
          disabled={!canControl}
          onChange={(event) => setVideoUrl(event.target.value)}
          placeholder="Paste video URL..."
        />
        <button type="submit" disabled={!canControl || !videoUrl.trim()}>
          Load
        </button>
        {proxyEnabled && isHost ? (
          <label className="row gap hint-inline">
            <input
              type="checkbox"
              checked={useProxy}
              disabled={!canControl}
              onChange={(event) => {
                setProxyTouched(true);
                setUseProxy(event.target.checked);
              }}
            />
            Use proxy
          </label>
        ) : null}
      </form>

      {loadError ? <p className="error">{loadError}</p> : null}

      <div className="media-bar">
        <button onClick={onTogglePlay} disabled={!canControl} className="toggle-btn">
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="number"
          step="0.1"
          min="0"
          value={seekInput}
          disabled={!canControl}
          onChange={(event) => setSeekInput(event.target.value)}
          placeholder="Seconds"
        />
        <button
          disabled={!canControl}
          onClick={() => {
            const parsed = Number(seekInput);
            if (Number.isFinite(parsed) && parsed >= 0) {
              onSeek(parsed);
            }
          }}
        >
          Seek
        </button>
        <select
          value={playbackRate}
          disabled={!canControl}
          onChange={(event) => onRate(Number(event.target.value))}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
        <span className="hint">{currentTime.toFixed(2)}s</span>
      </div>

      {isHost ? (
        <label className="row gap hint-inline">
          <input
            type="checkbox"
            checked={allowAllControls}
            onChange={(event) => onToggleAllowAll(event.target.checked)}
          />
          Allow anyone to control
        </label>
      ) : null}
    </section>
  );
}
