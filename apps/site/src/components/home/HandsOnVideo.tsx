import { PlayCircle } from "lucide-react";

export function HandsOnVideo() {
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

      <div data-hands-on-video-player aria-label="NativeScope hands-on video placeholder">
        <div data-hands-on-video-placeholder>
          <PlayCircle size={28} aria-hidden />
          <div>
            <strong>Hands-on walkthrough</strong>
            <span>The YouTube walkthrough will play here.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
