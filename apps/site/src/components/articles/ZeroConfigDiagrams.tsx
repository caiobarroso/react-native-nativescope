import type { ReactNode } from "react";

function DiagramFigure({ children, caption }: { children: ReactNode; caption: ReactNode }) {
  return (
    <figure data-scale-figure>
      <div data-scale-panel>{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function ResolverInterceptDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 1</strong> Metro changes the route, not the app. Development imports pass through a transparent shim; release imports do not.</>}
    >
      <svg viewBox="0 0 720 300" role="img" aria-label="An unchanged app import reaches Metro. In development NativeScope routes it through a transparent shim and then the real module. In release Metro resolves the real module directly.">
        <defs>
          <marker id="resolver-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
          <marker id="resolver-soft-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-subtle-fill /></marker>
        </defs>

        <text x="28" y="26" data-svg-eyebrow data-svg-muted-fill>APP SOURCE · UNCHANGED</text>
        <rect x="28" y="44" width="190" height="72" rx="9" data-svg-surface data-svg-stroke />
        <text x="46" y="74" data-svg-label>import AsyncStorage</text>
        <text x="46" y="96" data-svg-faint>already in your code</text>

        <line x1="220" y1="80" x2="252" y2="80" data-svg-accent markerEnd="url(#resolver-arrow)" />
        <rect x="258" y="44" width="150" height="72" rx="9" data-svg-accent-wash />
        <text x="333" y="73" textAnchor="middle" data-svg-big>Metro</text>
        <text x="333" y="95" textAnchor="middle" data-svg-accent-text>resolveRequest</text>

        <path d="M408 68 L470 68 L470 54 L512 54" data-svg-accent markerEnd="url(#resolver-arrow)" />
        <text x="441" y="49" textAnchor="middle" data-svg-accent-text>dev</text>
        <rect x="518" y="30" width="190" height="52" rx="8" data-svg-accent-wash />
        <text x="613" y="54" textAnchor="middle" data-svg-big>NativeScope shim</text>
        <text x="613" y="70" textAnchor="middle" data-svg-faint>observe · re-export</text>

        <path d="M408 94 L470 94 L470 118 L512 118" data-svg-subtle-line markerEnd="url(#resolver-soft-arrow)" />
        <text x="445" y="110" textAnchor="middle" data-svg-faint>release</text>
        <rect x="518" y="94" width="190" height="52" rx="8" data-svg-surface data-svg-stroke />
        <text x="613" y="118" textAnchor="middle" data-svg-label>real module</text>
        <text x="613" y="134" textAnchor="middle" data-svg-faint>direct resolution</text>

        <path d="M613 82 L613 92" data-svg-accent markerEnd="url(#resolver-arrow)" />
        <line x1="28" y1="190" x2="692" y2="190" data-svg-divider />

        <text x="28" y="218" data-svg-eyebrow data-svg-muted-fill>THE CONTRACT</text>
        <rect x="28" y="234" width="664" height="44" rx="7" data-svg-surface data-svg-stroke />
        <text x="50" y="261" data-svg-label>same import</text>
        <text x="150" y="261" data-svg-faint>→</text>
        <text x="178" y="261" data-svg-label>same public API</text>
        <text x="310" y="261" data-svg-faint>→</text>
        <text x="338" y="261" data-svg-accent-text>inspection attached in dev</text>
      </svg>
    </DiagramFigure>
  );
}

export function ResolverCompositionDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 2</strong> NativeScope composes with the project. Existing resolution stays authoritative, while shim-originated requests bypass interception.</>}
    >
      <svg viewBox="0 0 720 300" role="img" aria-label="NativeScope wraps an existing Metro resolver instead of replacing it. Storage imports are intercepted, unrelated imports continue to the previous resolver, and requests from inside a shim bypass interception to avoid a loop.">
        <defs>
          <marker id="composition-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
          <marker id="composition-soft-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-subtle-fill /></marker>
        </defs>

        <text x="28" y="26" data-svg-eyebrow data-svg-muted-fill>COMPOSED RESOLVER</text>
        <rect x="28" y="44" width="176" height="72" rx="9" data-svg-surface data-svg-stroke />
        <text x="116" y="73" textAnchor="middle" data-svg-label>module request</text>
        <text x="116" y="95" textAnchor="middle" data-svg-faint>name · platform</text>
        <line x1="204" y1="80" x2="230" y2="80" data-svg-accent markerEnd="url(#composition-arrow)" />

        <rect x="236" y="38" width="236" height="84" rx="9" data-svg-accent-wash />
        <text x="354" y="69" textAnchor="middle" data-svg-big>withNativeScope</text>
        <text x="354" y="91" textAnchor="middle" data-svg-accent-text>intercepts known modules</text>
        <text x="354" y="108" textAnchor="middle" data-svg-faint>keeps the previous resolver</text>

        <path d="M472 66 L506 66 L506 52 L518 52" data-svg-accent markerEnd="url(#composition-arrow)" />
        <rect x="524" y="30" width="172" height="50" rx="8" data-svg-accent-wash />
        <text x="610" y="60" textAnchor="middle" data-svg-label>storage shim</text>
        <path d="M472 96 L506 96 L506 112 L518 112" data-svg-subtle-line markerEnd="url(#composition-soft-arrow)" />
        <rect x="524" y="92" width="172" height="54" rx="8" data-svg-surface data-svg-stroke />
        <text x="610" y="114" textAnchor="middle" data-svg-label>previous resolver</text>
        <text x="610" y="132" textAnchor="middle" data-svg-faint>everything else</text>

        <line x1="28" y1="170" x2="692" y2="170" data-svg-divider />
        <text x="28" y="198" data-svg-eyebrow data-svg-muted-fill>ANTI-LOOP + SINGLETONS</text>
        <rect x="28" y="216" width="234" height="68" rx="8" data-svg-surface data-svg-stroke />
        <text x="145" y="244" textAnchor="middle" data-svg-label>request originates in shim</text>
        <text x="145" y="266" textAnchor="middle" data-svg-faint>do not intercept again</text>
        <line x1="262" y1="250" x2="284" y2="250" data-svg-accent markerEnd="url(#composition-arrow)" />
        <rect x="290" y="216" width="176" height="68" rx="8" data-svg-accent-wash />
        <text x="378" y="244" textAnchor="middle" data-svg-accent-text>bypass</text>
        <text x="378" y="266" textAnchor="middle" data-svg-faint>resolve real module</text>

        <rect x="478" y="216" width="214" height="68" rx="8" data-svg-panel data-svg-stroke data-svg-dash />
        <text x="585" y="244" textAnchor="middle" data-svg-label>React · React Native</text>
        <text x="585" y="266" textAnchor="middle" data-svg-faint>resolved by the host app</text>
      </svg>
    </DiagramFigure>
  );
}

export function AutoDiscoveryDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 3</strong> The registry is a consequence of normal app behavior. Instances appear when the app uses them, with no second inventory to maintain.</>}
    >
      <svg viewBox="0 0 720 310" role="img" aria-label="Normal AsyncStorage calls, MMKV instance creation and SQLite database opens feed an automatic registry, which produces the provider list visible in NativeScope Studio.">
        <defs>
          <marker id="discovery-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
        </defs>

        <text x="28" y="26" data-svg-eyebrow data-svg-muted-fill>THE APP USES STORAGE NORMALLY</text>
        <DiscoveryEvent y={46} provider="AsyncStorage" event="getItem · setItem · remove" />
        <DiscoveryEvent y={108} provider="MMKV" event="new MMKV({ id: 'cache' })" />
        <DiscoveryEvent y={170} provider="SQLite" event="openDatabaseAsync('app.db')" />

        <line x1="274" y1="88" x2="322" y2="104" data-svg-accent markerEnd="url(#discovery-arrow)" />
        <line x1="274" y1="134" x2="322" y2="134" data-svg-accent markerEnd="url(#discovery-arrow)" />
        <line x1="274" y1="194" x2="322" y2="164" data-svg-accent markerEnd="url(#discovery-arrow)" />

        <rect x="328" y="80" width="168" height="108" rx="10" data-svg-accent-wash />
        <text x="412" y="111" textAnchor="middle" data-svg-big>auto registry</text>
        <text x="412" y="137" textAnchor="middle" data-svg-faint>provider · scope</text>
        <text x="412" y="158" textAnchor="middle" data-svg-faint>instance · db</text>

        <line x1="496" y1="134" x2="526" y2="134" data-svg-accent markerEnd="url(#discovery-arrow)" />
        <rect x="532" y="42" width="160" height="190" rx="10" data-svg-surface data-svg-stroke />
        <text x="550" y="68" data-svg-eyebrow data-svg-muted-fill>STUDIO</text>
        <RegistryRow y={82} label="ASYNCSTORAGE" value="default" />
        <RegistryRow y={126} label="MMKV" value="cache" />
        <RegistryRow y={170} label="SQLITE" value="app.db" />

        <rect x="28" y="258" width="664" height="32" rx="6" data-svg-panel data-svg-stroke data-svg-dash />
        <text x="360" y="279" textAnchor="middle" data-svg-faint>no provider list · no instance names · no query keys copied into NativeScope</text>
      </svg>
    </DiagramFigure>
  );
}

function DiscoveryEvent({ y, provider, event }: { y: number; provider: string; event: string }) {
  return (
    <g>
      <rect x="28" y={y} width="246" height="48" rx="7" data-svg-surface data-svg-stroke />
      <text x="44" y={y + 20} data-svg-label>{provider}</text>
      <text x="44" y={y + 37} data-svg-faint>{event}</text>
    </g>
  );
}

function RegistryRow({ y, label, value }: { y: number; label: string; value: string }) {
  return (
    <g>
      <rect x="546" y={y} width="132" height="36" rx="5" data-svg-panel data-svg-stroke />
      <text x="556" y={y + 14} data-svg-eyebrow data-svg-muted-fill>{label}</text>
      <text x="556" y={y + 29} data-svg-faint>{value}</text>
    </g>
  );
}

export function ReleaseBoundaryDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 4</strong> Two independent boundaries: release resolution skips instrumentation, then CI verifies the exported bundle anyway.</>}
    >
      <svg viewBox="0 0 720 300" role="img" aria-label="A development bundle may contain NativeScope shims. A release bundle resolves real modules directly and CI scans it for the shim marker, passing only when the marker is absent.">
        <defs>
          <marker id="release-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
          <marker id="release-created-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-created-fill /></marker>
        </defs>

        <text x="28" y="26" data-svg-eyebrow data-svg-muted-fill>DEVELOPMENT LANE</text>
        <rect x="28" y="42" width="140" height="56" rx="8" data-svg-surface data-svg-stroke />
        <text x="98" y="67" textAnchor="middle" data-svg-label>Metro dev</text>
        <text x="98" y="85" textAnchor="middle" data-svg-faint>NativeScope on</text>
        <line x1="168" y1="70" x2="226" y2="70" data-svg-accent markerEnd="url(#release-arrow)" />
        <rect x="232" y="42" width="178" height="56" rx="8" data-svg-accent-wash />
        <text x="321" y="67" textAnchor="middle" data-svg-label>instrumented bundle</text>
        <text x="321" y="85" textAnchor="middle" data-svg-accent-text>__RNSI_SHIM__ ok</text>
        <rect x="450" y="42" width="242" height="56" rx="8" data-svg-panel data-svg-stroke data-svg-dash />
        <text x="571" y="67" textAnchor="middle" data-svg-label>local debugging only</text>
        <text x="571" y="85" textAnchor="middle" data-svg-faint>browser + device, local</text>

        <line x1="28" y1="126" x2="692" y2="126" data-svg-divider />
        <text x="28" y="156" data-svg-eyebrow data-svg-muted-fill>RELEASE LANE</text>
        <rect x="28" y="172" width="140" height="56" rx="8" data-svg-surface data-svg-stroke />
        <text x="98" y="197" textAnchor="middle" data-svg-label>Metro release</text>
        <text x="98" y="215" textAnchor="middle" data-svg-faint>real modules only</text>
        <line x1="168" y1="200" x2="226" y2="200" data-svg-accent markerEnd="url(#release-arrow)" />
        <rect x="232" y="172" width="178" height="56" rx="8" data-svg-surface data-svg-stroke />
        <text x="321" y="197" textAnchor="middle" data-svg-label>exported bundle</text>
        <text x="321" y="215" textAnchor="middle" data-svg-faint>second boundary: scan</text>
        <line x1="410" y1="200" x2="468" y2="200" data-svg-created markerEnd="url(#release-created-arrow)" />
        <rect x="474" y="164" width="218" height="72" rx="9" data-svg-created-wash />
        <text x="583" y="189" textAnchor="middle" data-svg-created-text>marker not found · pass</text>
        <text x="583" y="211" textAnchor="middle" data-svg-faint>marker found → build fails</text>

        <text x="360" y="276" textAnchor="middle" data-svg-accent-text>dev-only by resolution · enforced again by CI</text>
      </svg>
    </DiagramFigure>
  );
}

export function OptionalConfigDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 5</strong> Configuration describes behavior NativeScope cannot infer. It never becomes an inventory of the app&apos;s storage.</>}
    >
      <svg viewBox="0 0 720 280" role="img" aria-label="Storage providers, namespaces and database names are inferred automatically. An optional NativeScope config is reserved for behavior such as cache invalidation after dashboard edits.">
        <text x="28" y="28" data-svg-eyebrow data-svg-muted-fill>AUTOMATIC · DEFAULT PATH</text>
        <rect x="28" y="44" width="410" height="170" rx="10" data-svg-accent-wash />
        <ConfigRow y={62} label="providers" value="AsyncStorage · MMKV · SQLite" />
        <ConfigRow y={104} label="instances" value="observed when the app creates them" />
        <ConfigRow y={146} label="databases" value="registered when the app opens them" />
        <text x="233" y="198" textAnchor="middle" data-svg-accent-text>zero app-owned NativeScope code</text>

        <text x="474" y="28" data-svg-eyebrow data-svg-muted-fill>OPTIONAL</text>
        <rect x="474" y="44" width="218" height="170" rx="10" data-svg-surface data-svg-stroke />
        <text x="492" y="74" data-svg-label>nativescope.config.ts</text>
        <line x1="492" y1="88" x2="674" y2="88" data-svg-divider />
        <text x="492" y="116" data-svg-faint>cache invalidation</text>
        <text x="492" y="140" data-svg-faint>client state refresh</text>
        <text x="492" y="164" data-svg-faint>behavior that cannot</text>
        <text x="492" y="182" data-svg-faint>be inferred safely</text>

        <rect x="28" y="238" width="664" height="26" rx="5" data-svg-panel data-svg-stroke data-svg-dash />
        <text x="360" y="256" textAnchor="middle" data-svg-faint>storage discovery works identically with or without this file</text>
      </svg>
    </DiagramFigure>
  );
}

function ConfigRow({ y, label, value }: { y: number; label: string; value: string }) {
  return (
    <g>
      <rect x="46" y={y} width="374" height="34" rx="5" data-svg-surface data-svg-stroke />
      <text x="60" y={y + 22} data-svg-label>{label}</text>
      <text x="166" y={y + 22} data-svg-faint>{value}</text>
    </g>
  );
}
