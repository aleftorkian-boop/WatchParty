import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectHlsFromSource } from "../lib/parseVideoUrl";
import type { ResolvedKind } from "../lib/types";

interface PlayerProps {
  sourceUrl: string | null;
  sourceKind?: ResolvedKind;
  sourceVideoId?: string;
  isPlaying: boolean;
  expectedTime: number;
  playbackRate: number;
  canControl: boolean;
  onPlayRequest: (atTime: number) => void;
  onPauseRequest: (atTime: number) => void;
  onSeekRequest: (toTime: number) => void;
  onTimeUpdate: (time: number) => void;
}

interface YouTubePlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
}

interface YouTubeAPI {
  Player: new (
    container: string | HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<YouTubeAPI> | null = null;

const DRIVE_STREAM_ERROR_MESSAGE =
  "Google Drive link could not be streamed. Make sure the file is set to 'Anyone with the link' and try again. Some Drive files require a download confirmation page and cannot be streamed reliably.";

function isDriveSourceUrl(rawUrl: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() === "drive.google.com") {
      return true;
    }

    const proxied = parsed.searchParams.get("url");
    if (!proxied) return false;
    const upstream = new URL(proxied);
    return upstream.hostname.toLowerCase() === "drive.google.com";
  } catch {
    return false;
  }
}

function loadYouTubeAPI(): Promise<YouTubeAPI> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube API is only available in browser"));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youTubeApiPromise) {
    return youTubeApiPromise;
  }

  youTubeApiPromise = new Promise<YouTubeAPI>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return youTubeApiPromise;
}

export default function Player({
  sourceUrl,
  sourceKind,
  sourceVideoId,
  isPlaying,
  expectedTime,
  playbackRate,
  canControl,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
  onTimeUpdate,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);
  const ytPlayerContainerIdRef = useRef(`yt-player-${Math.random().toString(36).slice(2, 10)}`);

  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [youtubeError, setYouTubeError] = useState<string | null>(null);
  const [driveStreamError, setDriveStreamError] = useState<string | null>(null);

  const isApplyingRemoteUpdateRef = useRef(false);
  const isPlayerReadyRef = useRef(false);
  const lastCorrectionMsRef = useRef(0);
  const lastYouTubeSeekEmitMsRef = useRef(0);
  const lastYouTubeStateEmitRef = useRef<{ state: number; atMs: number } | null>(null);
  const lastYouTubeTimeRef = useRef<number | null>(null);
  const lastLocalActionAtRef = useRef<number>(0);
  const lastLocalActionTypeRef = useRef<"play" | "pause" | "seek" | null>(null);

  const canControlRef = useRef(canControl);
  const onPlayRequestRef = useRef(onPlayRequest);
  const onPauseRequestRef = useRef(onPauseRequest);
  const onSeekRequestRef = useRef(onSeekRequest);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const expectedTimeRef = useRef(expectedTime);
  const playbackRateRef = useRef(playbackRate);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    canControlRef.current = canControl;
    onPlayRequestRef.current = onPlayRequest;
    onPauseRequestRef.current = onPauseRequest;
    onSeekRequestRef.current = onSeekRequest;
    onTimeUpdateRef.current = onTimeUpdate;
  }, [canControl, onPauseRequest, onPlayRequest, onSeekRequest, onTimeUpdate]);

  useEffect(() => {
    expectedTimeRef.current = expectedTime;
    playbackRateRef.current = playbackRate;
    isPlayingRef.current = isPlaying;
  }, [expectedTime, isPlaying, playbackRate]);

  const isYouTubeSource = sourceKind === "youtube" || Boolean(sourceVideoId);
  const isDriveSource = useMemo(() => !isYouTubeSource && isDriveSourceUrl(sourceUrl), [isYouTubeSource, sourceUrl]);
  const youtubeVideoId = useMemo(() => {
    if (!isYouTubeSource) return null;
    const id = sourceVideoId?.trim() || "";
    return id.length > 0 ? id : null;
  }, [isYouTubeSource, sourceVideoId]);

  function getTime(): number {
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      return yt && typeof yt.getCurrentTime === "function" ? yt.getCurrentTime() || 0 : 0;
    }
    return videoRef.current?.currentTime ?? 0;
  }

  function setTime(time: number): void {
    const next = Math.max(0, time);
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      if (yt && typeof yt.seekTo === "function") {
        yt.seekTo(next, true);
      }
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = next;
    }
  }

  async function playCurrent(): Promise<void> {
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      if (yt && typeof yt.playVideo === "function") {
        yt.playVideo();
      }
      return;
    }
    await videoRef.current?.play();
  }

  function pauseCurrent(): void {
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      if (yt && typeof yt.pauseVideo === "function") {
        yt.pauseVideo();
      }
      return;
    }
    videoRef.current?.pause();
  }

  function setRate(rate: number): void {
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      if (yt && typeof yt.setPlaybackRate === "function") {
        yt.setPlaybackRate(rate);
      }
      return;
    }
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }

  function getRate(): number {
    if (isYouTubeSource) {
      const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
      return yt && typeof yt.getPlaybackRate === "function" ? yt.getPlaybackRate() : 1;
    }
    return videoRef.current?.playbackRate ?? 1;
  }

  function getYouTubeState(): number | null {
    const yt = ytPlayerRef.current as Partial<YouTubePlayer> | null;
    if (yt && typeof yt.getPlayerState === "function") {
      return yt.getPlayerState();
    }
    return null;
  }

  function markLocalAction(type: "play" | "pause" | "seek"): void {
    lastLocalActionAtRef.current = Date.now();
    lastLocalActionTypeRef.current = type;
  }

  const shouldUseHlsJs = useMemo(() => {
    if (!sourceUrl || isYouTubeSource) return false;
    return detectHlsFromSource(sourceUrl);
  }, [isYouTubeSource, sourceUrl]);

  useEffect(() => {
    if (isYouTubeSource) {
      isPlayerReadyRef.current = false;
      isApplyingRemoteUpdateRef.current = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    isPlayerReadyRef.current = false;
    isApplyingRemoteUpdateRef.current = true;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!sourceUrl) {
      video.removeAttribute("src");
      video.load();
      return;
    }

    const canPlayNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    if (shouldUseHlsJs && !canPlayNativeHls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(sourceUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else {
      video.src = sourceUrl;
    }

    video.load();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isYouTubeSource, sourceUrl, shouldUseHlsJs]);

  useEffect(() => {
    setDriveStreamError(null);
  }, [sourceUrl]);

  useEffect(() => {
    if (isYouTubeSource) return;

    const video = videoRef.current;
    if (!video) return;

    onTimeUpdateRef.current(expectedTime);
    isApplyingRemoteUpdateRef.current = true;

    if (!isPlayerReadyRef.current) {
      return;
    }

    if (Math.abs(video.playbackRate - playbackRate) > 0.001) {
      video.playbackRate = playbackRate;
    }

    const now = Date.now();
    const drift = Math.abs(video.currentTime - expectedTime);
    if (drift > 0.5 && now - lastCorrectionMsRef.current >= 1_000) {
      video.currentTime = Math.max(0, expectedTime);
      lastCorrectionMsRef.current = now;
    }

    const syncPlayback = async () => {
      if (isPlaying && video.paused) {
        try {
          await video.play();
          setAutoplayBlocked(false);
        } catch {
          setAutoplayBlocked(true);
        }
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
      isApplyingRemoteUpdateRef.current = false;
    };

    syncPlayback();
  }, [expectedTime, isPlaying, isYouTubeSource, playbackRate]);

  useEffect(() => {
    if (!isYouTubeSource || !youtubeVideoId) {
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
      isPlayerReadyRef.current = false;
      setYouTubeError(null);
      return;
    }

    let cancelled = false;
    setAutoplayBlocked(false);
    setYouTubeError(null);

    loadYouTubeAPI()
      .then((YT) => {
        if (cancelled) return;

        if (ytPlayerRef.current) {
          ytPlayerRef.current.destroy();
          ytPlayerRef.current = null;
        }

        ytPlayerRef.current = new YT.Player(ytPlayerContainerIdRef.current, {
          videoId: youtubeVideoId,
          playerVars: { playsinline: 1, rel: 0, controls: 1, disablekb: 0 },
          events: {
            onReady: () => {
              isPlayerReadyRef.current = true;
              setRate(playbackRateRef.current);
              setTime(expectedTimeRef.current);
              if (isPlayingRef.current) {
                void playCurrent();
              } else {
                pauseCurrent();
              }
              onTimeUpdateRef.current(expectedTimeRef.current);
              isApplyingRemoteUpdateRef.current = false;
            },
            onStateChange: (event) => {
              const player = ytPlayerRef.current;
              if (!player) return;

              const currentTime = getTime();
              onTimeUpdateRef.current(currentTime);

              if (isApplyingRemoteUpdateRef.current || !isPlayerReadyRef.current || !canControlRef.current) return;
              const now = Date.now();
              const lastState = lastYouTubeStateEmitRef.current;
              if (lastState && lastState.state === event.data && now - lastState.atMs < 300) {
                return;
              }
              lastYouTubeStateEmitRef.current = { state: event.data, atMs: now };

              if (event.data === YT.PlayerState.PLAYING) {
                markLocalAction("play");
                onPlayRequestRef.current(currentTime);
              } else if (event.data === YT.PlayerState.PAUSED) {
                markLocalAction("pause");
                onPauseRequestRef.current(currentTime);
              }
            },
            onError: (event) => {
              if (event.data === 101 || event.data === 150) {
                setYouTubeError("This YouTube video can't be embedded. Try another video.");
              } else {
                setYouTubeError("Unable to play this YouTube video.");
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setYouTubeError("Unable to load YouTube player.");
        }
      });

    return () => {
      cancelled = true;
      isPlayerReadyRef.current = false;
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
      lastYouTubeTimeRef.current = null;
    };
  }, [isYouTubeSource, youtubeVideoId]);

  useEffect(() => {
    if (!isYouTubeSource) return;

    const timer = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;

      const now = Date.now();
      const currentTime = getTime();
      onTimeUpdateRef.current(currentTime);

      if (!isPlayerReadyRef.current || !canControlRef.current || isApplyingRemoteUpdateRef.current) {
        lastYouTubeTimeRef.current = currentTime;
        return;
      }

      const prev = lastYouTubeTimeRef.current;
      if (
        prev !== null &&
        Math.abs(currentTime - prev) > 1.5 &&
        now - lastYouTubeSeekEmitMsRef.current >= 1_000
      ) {
        lastYouTubeSeekEmitMsRef.current = now;
        markLocalAction("seek");
        onSeekRequestRef.current(currentTime);
      }

      lastYouTubeTimeRef.current = currentTime;
    }, 500);

    return () => window.clearInterval(timer);
  }, [isYouTubeSource]);

  useEffect(() => {
    if (!isYouTubeSource) return;

    const player = ytPlayerRef.current;
    if (!player) return;

    onTimeUpdateRef.current(expectedTime);
    isApplyingRemoteUpdateRef.current = true;

    if (!isPlayerReadyRef.current) {
      return;
    }

    try {
      if (Math.abs(getRate() - playbackRate) > 0.001) {
        setRate(playbackRate);
      }
    } catch {
      // Ignore unsupported playback rate transitions for this video.
    }

    const now = Date.now();
    const currentTime = getTime();
    const drift = Math.abs(currentTime - expectedTime);
    const localActionAgeMs = now - lastLocalActionAtRef.current;
    const hasRecentLocalAction = localActionAgeMs < 800;
    if (
      drift > 0.5 &&
      now - lastCorrectionMsRef.current >= 1_000 &&
      !(hasRecentLocalAction && lastLocalActionTypeRef.current === "seek")
    ) {
      setTime(expectedTime);
      lastCorrectionMsRef.current = now;
    }

    const state = getYouTubeState();
    const ytState = window.YT?.PlayerState;

    if (hasRecentLocalAction && ytState && state !== null) {
      if (lastLocalActionTypeRef.current === "pause" && state === ytState.PAUSED && isPlaying) {
        setTimeout(() => {
          isApplyingRemoteUpdateRef.current = false;
        }, 150);
        return;
      }

      if (lastLocalActionTypeRef.current === "play" && state === ytState.PLAYING && !isPlaying) {
        setTimeout(() => {
          isApplyingRemoteUpdateRef.current = false;
        }, 150);
        return;
      }
    }

    if (isPlaying && ytState && state !== null && state !== ytState.PLAYING) {
      void playCurrent();
      window.setTimeout(() => {
        const nextState = getYouTubeState();
        if (nextState === null || nextState !== window.YT?.PlayerState.PLAYING) {
          setAutoplayBlocked(true);
        } else {
          setAutoplayBlocked(false);
        }
      }, 600);
    } else if (!isPlaying && ytState && state === ytState.PLAYING) {
      pauseCurrent();
      setAutoplayBlocked(false);
    }

    setTimeout(() => {
      isApplyingRemoteUpdateRef.current = false;
    }, 150);
  }, [expectedTime, isPlaying, isYouTubeSource, playbackRate]);

  return (
    <section className="panel player-panel">
      <h3>Player</h3>
      {isYouTubeSource ? (
        <>
          <div id={ytPlayerContainerIdRef.current} className="video" />
          {youtubeError ? <p className="error">{youtubeError}</p> : null}
        </>
      ) : (
        <video
          ref={videoRef}
          className="video"
          controls={canControl}
          onTimeUpdate={() => onTimeUpdate(videoRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => {
            setDriveStreamError(null);
            isPlayerReadyRef.current = true;
            setRate(playbackRateRef.current);
            setTime(expectedTimeRef.current);
            if (isPlayingRef.current) {
              void playCurrent();
            } else {
              pauseCurrent();
            }
            onTimeUpdateRef.current(expectedTimeRef.current);
            isApplyingRemoteUpdateRef.current = false;
          }}
          onPlay={() => {
            if (isApplyingRemoteUpdateRef.current || !isPlayerReadyRef.current) return;
            onPlayRequest(videoRef.current?.currentTime ?? 0);
          }}
          onPause={() => {
            if (isApplyingRemoteUpdateRef.current || !isPlayerReadyRef.current) return;
            onPauseRequest(videoRef.current?.currentTime ?? 0);
          }}
          onSeeked={() => {
            if (isApplyingRemoteUpdateRef.current || !isPlayerReadyRef.current) return;
            onSeekRequest(videoRef.current?.currentTime ?? 0);
          }}
          onError={() => {
            if (isDriveSource) {
              setDriveStreamError(DRIVE_STREAM_ERROR_MESSAGE);
            }
          }}
          onStalled={() => {
            if (isDriveSource) {
              setDriveStreamError(DRIVE_STREAM_ERROR_MESSAGE);
            }
          }}
        />
      )}
      {!sourceUrl ? <p className="hint">Host must load a video URL to begin.</p> : null}
      {driveStreamError ? <p className="error">{driveStreamError}</p> : null}
      {autoplayBlocked ? (
        <button
          onClick={async () => {
            if (isYouTubeSource) {
              const player = ytPlayerRef.current;
              if (!player) return;
              await playCurrent();
              window.setTimeout(() => {
                const state = getYouTubeState();
                if (state === window.YT?.PlayerState.PLAYING) {
                  markLocalAction("play");
                  setAutoplayBlocked(false);
                  onPlayRequest(getTime());
                }
              }, 600);
              return;
            }

            const video = videoRef.current;
            if (!video) return;
            try {
              await video.play();
              setAutoplayBlocked(false);
              onPlayRequest(video.currentTime);
            } catch {
              setAutoplayBlocked(true);
            }
          }}
        >
          Start playback
        </button>
      ) : null}
    </section>
  );
}
