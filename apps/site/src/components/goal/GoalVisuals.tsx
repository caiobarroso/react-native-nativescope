import { highlightCode } from "@/lib/highlight";
const oneFileConfigCode = `import { defineNativeScopeConfig } from
  "react-native-nativescope/app"

export default defineNativeScopeConfig({
  modules: {
    storage: {
      indicator: true,
      reactQuery: true,
    },

    // Product direction: one config block per module
    // network: {
    //   enabled: true,
    // },
    // performance: {
    //   enabled: true,
    // },
    // navigation: {
    //   enabled: true,
    // },
  },
})`;

function ModuleNode({
  x,
  y,
  label,
  detail,
  active = false,
}: {
  x: number;
  y: number;
  label: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="184"
        height="58"
        rx="7"
        data-svg-surface={!active || undefined}
        data-svg-accent-wash={active || undefined}
        data-svg-stroke={!active || undefined}
      />
      <circle cx={x + 18} cy={y + 19} r="4" data-svg-accent-fill={active || undefined} data-svg-subtle-fill={!active || undefined} />
      <text x={x + 31} y={y + 23} data-svg-label>{label}</text>
      <text x={x + 18} y={y + 43} data-svg-faint>{detail}</text>
    </g>
  );
}

export function ModuleOrganism() {
  return (
    <figure data-goal-organism>
      <div data-goal-organism-canvas>
        <svg
          viewBox="0 0 980 520"
          role="img"
          aria-label="NativeScope as one local core connected to independent Storage, Network, Logs, State, Performance, Navigation, Files and Notifications modules. Storage is available now and the other modules represent the product direction."
        >
          <defs>
            <marker id="goal-tentacle-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5">
              <circle cx="5" cy="5" r="3" data-svg-subtle-fill />
            </marker>
            <marker id="goal-tentacle-active" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5">
              <circle cx="5" cy="5" r="3" data-svg-accent-fill />
            </marker>
          </defs>

          <text x="490" y="28" textAnchor="middle" data-svg-eyebrow data-svg-muted-fill>ONE LOCAL CORE · MODULES ONLY WHEN NEEDED</text>

          <path d="M420 197 C350 150 322 91 226 91" data-goal-tentacle="active" markerEnd="url(#goal-tentacle-active)" />
          <path d="M410 226 C344 220 314 205 226 205" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />
          <path d="M415 257 C340 278 310 319 226 319" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />
          <path d="M438 282 C365 354 330 433 226 433" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />

          <path d="M560 197 C630 150 658 91 754 91" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />
          <path d="M570 226 C636 220 666 205 754 205" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />
          <path d="M565 257 C640 278 670 319 754 319" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />
          <path d="M542 282 C615 354 650 433 754 433" data-goal-tentacle markerEnd="url(#goal-tentacle-dot)" />

          <path
            d="M490 112 C438 112 401 151 401 211 C401 274 438 311 490 311 C542 311 579 274 579 211 C579 151 542 112 490 112 Z"
            data-svg-accent-wash
          />
          <circle cx="459" cy="196" r="5" data-svg-accent-fill />
          <circle cx="521" cy="196" r="5" data-svg-accent-fill />
          <line x1="470" y1="224" x2="510" y2="224" data-svg-accent />
          <image
            href="/brand/nativescope-logo.png"
            x="430"
            y="242"
            width="120"
            height="25"
            data-goal-core-logo-light
          />
          <image
            href="/brand/nativescope-logo-reversed.png"
            x="430"
            y="242"
            width="120"
            height="25"
            data-goal-core-logo-dark
          />
          <text x="490" y="280" textAnchor="middle" data-svg-accent-text>local core</text>

          <ModuleNode x={42} y={62} label="Storage" detail="available now" active />
          <ModuleNode x={42} y={176} label="Network" detail="requests · replay" />
          <ModuleNode x={42} y={290} label="Logs" detail="structured timeline" />
          <ModuleNode x={42} y={404} label="State" detail="queries · stores" />
          <ModuleNode x={754} y={62} label="Performance" detail="frames · memory" />
          <ModuleNode x={754} y={176} label="Navigation" detail="routes · deep links" />
          <ModuleNode x={754} y={290} label="Files" detail="images · cache" />
          <ModuleNode x={754} y={404} label="Notifications" detail="payloads · events" />
        </svg>
      </div>
      <figcaption>
        The shape is modular on purpose. The Studio gains a surface only when its module is present;
        removing a module removes that surface without changing the rest.
      </figcaption>
    </figure>
  );
}

export async function OneFileContract() {
  const highlightedConfig = await highlightCode(oneFileConfigCode, "typescript");

  return (
    <figure data-goal-config-figure>
      <div data-goal-config-window>
        <header>
          <span>nativescope.config.ts</span>
          <small>one optional file</small>
        </header>
        <div data-goal-config-body>
          <div
            data-goal-config-code
            data-highlighted-code
            dangerouslySetInnerHTML={{ __html: highlightedConfig }}
          />
          <div data-goal-module-stack>
            <p><strong>Storage</strong><span>discovered automatically</span></p>
            <p><strong>+ Network</strong><span>one future config block</span></p>
            <p><strong>+ Performance</strong><span>one future config block</span></p>
            <p><strong>+ Navigation</strong><span>one future config block</span></p>
          </div>
        </div>
        <footer>
          <span>Your app remains yours.</span>
          <strong>NativeScope absorbs the integration work.</strong>
        </footer>
      </div>
      <figcaption>
        Storage needs no inventory in this file today. Unreleased module blocks are shown as comments
        to document the product direction without pretending that future APIs already exist.
      </figcaption>
    </figure>
  );
}
