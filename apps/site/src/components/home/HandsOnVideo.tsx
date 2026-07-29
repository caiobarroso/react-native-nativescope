"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";

/**
 * Facade de vídeo: mostra a thumbnail do YouTube com um botão de play e só
 * carrega o player (e o tracking do YouTube) DEPOIS do clique. Coerente com a
 * pegada do produto — nada pesado nem que telefona pra fora no page load. Usa
 * youtube-nocookie para não setar cookie antes do play.
 */
const VIDEO_ID = "YtwUsWQtMqA";

export function HandsOnVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <section data-hands-on-video aria-labelledby="hands-on-video-heading">
      <div data-hands-on-video-copy>
        <p data-section-kicker>See NativeScope in motion</p>
        <h2 id="hands-on-video-heading">A real debugging session. No polished shortcuts.</h2>
        <p>
          Follow the complete flow from connecting a running React Native app to finding, editing,
          comparing, and restoring its local data inside the Studio.
        </p>
      </div>

      <div data-hands-on-video-player>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title="NativeScope hands-on walkthrough"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            data-hands-on-video-poster
            onClick={() => setPlaying(true)}
            aria-label="Play the NativeScope walkthrough"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
              alt=""
              loading="lazy"
              onError={(event) => {
                // maxresdefault não existe para todo vídeo; cai no hqdefault (sempre existe).
                const img = event.currentTarget;
                if (img.src.includes("maxresdefault")) {
                  img.src = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;
                }
              }}
            />
            <span data-hands-on-video-play>
              <PlayCircle size={30} strokeWidth={1.5} aria-hidden />
              Play walkthrough
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
